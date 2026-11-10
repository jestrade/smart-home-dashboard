// Home bridges: small programs on the home network for devices whose API is local-only
// (Motion Blinds gateway). A bridge authenticates with a token generated in the dashboard;
// only its SHA-256 hash is stored. It reports device state and polls for queued commands.
import crypto from 'node:crypto';
import { logger } from 'firebase-functions';
import { db, FieldValue } from './admin.js';

export const QUEUE = 'bridgeQueue';
export const COMMAND_TTL_MS = 20_000; // commands older than this are never executed
export const MAX_DEVICES = 64;

export const newBridgeToken = (provider) => `${provider}_${crypto.randomBytes(24).toString('base64url')}`;
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function tokenMatches(token, storedHash) {
  if (!token || !storedHash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Resolves `Authorization: Bearer <token>` to the provider it belongs to, or null. */
export async function authenticateBridge(req, provider) {
  const token = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
  if (!token || !token.startsWith(`${provider}_`)) return null;
  const snap = await db.doc(`integrations/${provider}`).get();
  return tokenMatches(token, snap.get('bridgeTokenHash')) ? provider : null;
}

/** Queue a command for the bridge and wait (briefly) for its result. */
export async function queueAndWait(provider, command, { waitMs = 12_000, pollMs = 500 } = {}) {
  const ref = await db.collection(QUEUE).add({ provider, ...command, status: 'pending', createdAt: Date.now() });
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const d = (await ref.get()).data();
    if (d?.status === 'done') {
      await ref.delete();
      return { ok: true, state: d.result ?? {} };
    }
    if (d?.status === 'failed') {
      await ref.delete();
      return { ok: false, error: d.error ?? 'The bridge reported an error.' };
    }
  }
  // Never let a late bridge run a command the user already saw fail.
  await ref.set({ status: 'expired' }, { merge: true });
  return { ok: false, error: 'The home bridge did not answer. Is it running?' };
}

/** GET …/commands: hand pending, still-fresh commands to the bridge. */
export async function takeCommands(provider) {
  const snap = await db.collection(QUEUE).where('provider', '==', provider).where('status', '==', 'pending').limit(10).get();
  const now = Date.now();
  const out = [];
  const batch = db.batch();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (now - d.createdAt > COMMAND_TTL_MS) {
      batch.set(doc.ref, { status: 'expired' }, { merge: true });
      continue;
    }
    batch.set(doc.ref, { status: 'delivered', deliveredAt: now }, { merge: true });
    out.push({ id: doc.id, deviceId: d.deviceId, action: d.action, value: d.value ?? null });
  }
  if (!snap.empty) await batch.commit();
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** POST …/result: the bridge reports the outcome of one command. */
export async function storeResult(provider, { id, ok, error, state }) {
  if (typeof id !== 'string' || !id) return false;
  const ref = db.collection(QUEUE).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.get('provider') !== provider) return false;
  await ref.set(
    ok ? { status: 'done', result: state ?? {} } : { status: 'failed', error: String(error ?? 'failed').slice(0, 300) },
    { merge: true },
  );
  return true;
}

/** POST …/report: store the device list the bridge sees (sanitised, bounded). */
export async function storeReport(provider, body, sanitize) {
  const devices = Array.isArray(body?.devices) ? body.devices.slice(0, MAX_DEVICES).map(sanitize).filter(Boolean) : [];
  await db.doc(`integrations/${provider}`).set(
    {
      devices,
      lastReportAt: Date.now(),
      bridgeVersion: String(body?.bridgeVersion ?? '').slice(0, 20) || null,
      bridgeReportedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  logger.info(`${provider} bridge reported ${devices.length} devices`);
  return devices.length;
}
