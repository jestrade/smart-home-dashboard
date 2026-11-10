import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db, FieldValue } from './admin.js';
import { providers } from '../providers/index.js';

// Which capability each action needs on the device.
export const ACTION_CAPABILITY = {
  setOn: 'onoff',
  setBrightness: 'brightness',
  setTemperature: 'thermostat',
  setMode: 'mode',
  lock: 'lock',
  unlock: 'lock',
  cover: 'cover',
  climateStart: 'climate',
  climateStop: 'climate',
  honkFlash: 'honkFlash',
  pauseCharging: 'charge',
  resumeCharging: 'charge',
  setMaxCurrent: 'chargeCurrent',
  snapshot: 'snapshot',
};

export function getProvider(id) {
  const p = providers[id];
  if (!p) throw new HttpsError('invalid-argument', `Unknown provider "${id}".`);
  return p;
}

export const deviceDocId = (provider, providerId) =>
  `${provider}_${String(providerId).replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 200);

const integrationRef = (id) => db.doc(`integrations/${id}`);
const statusRef = (id) => db.doc(`integrationStatus/${id}`);

export async function loadConfig(id) {
  const snap = await integrationRef(id).get();
  return snap.exists ? snap.data() : {};
}

export const ctxFor = (id) => ({
  saveConfig: (patch) => integrationRef(id).set(patch, { merge: true }),
});

export const isConfigured = (p, cfg) => p.requiredConfig.every((k) => cfg[k]);
export const isConnected = (p, cfg) =>
  p.isConnected ? p.isConnected(cfg) : isConfigured(p, cfg) && (!p.oauth || Boolean(cfg.refreshToken));

export async function writeStatus(id, cfg, extra = {}) {
  const p = getProvider(id);
  await statusRef(id).set(
    {
      provider: id,
      configured: isConfigured(p, cfg),
      connected: isConnected(p, cfg),
      oauth: Boolean(p.oauth),
      fieldsSet: p.configFields.filter((k) => cfg[k]),
      ...extra,
    },
    { merge: true },
  );
}

export async function syncProvider(id) {
  const p = getProvider(id);
  const cfg = await loadConfig(id);
  if (!isConnected(p, cfg)) {
    await writeStatus(id, cfg);
    return { provider: id, skipped: true };
  }
  try {
    const devices = await p.listDevices(cfg, ctxFor(id));
    const existing = await db.collection('devices').where('provider', '==', id).get();
    const batch = db.batch();
    const seen = new Set();
    for (const d of devices) {
      const docId = deviceDocId(id, d.providerId);
      seen.add(docId);
      const data = { ...d, id: docId, provider: id, stale: false, updatedAt: FieldValue.serverTimestamp() };
      // mergeFields replaces provider-owned fields wholesale but never touches user `prefs`.
      batch.set(db.doc(`devices/${docId}`), data, { mergeFields: Object.keys(data) });
    }
    existing.forEach((doc) => {
      if (!seen.has(doc.id)) batch.update(doc.ref, { stale: true, online: false });
    });
    await batch.commit();
    await writeStatus(id, cfg, {
      lastSyncAt: FieldValue.serverTimestamp(),
      lastError: null,
      deviceCount: devices.length,
    });
    return { provider: id, count: devices.length };
  } catch (e) {
    logger.error(`sync ${id} failed`, e);
    await writeStatus(id, cfg, {
      lastError: e.message,
      lastErrorAt: FieldValue.serverTimestamp(),
      ...(e.status === 401 ? { connected: false } : {}),
    });
    return { provider: id, error: e.message };
  }
}

export async function syncAll() {
  return Promise.all(Object.keys(providers).map(syncProvider));
}

export async function runCommand({ deviceId, action, value, email }) {
  const ref = db.doc(`devices/${deviceId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Device not found.');
  const device = snap.data();
  if (!device.capabilities?.includes(ACTION_CAPABILITY[action])) {
    throw new HttpsError('invalid-argument', `${device.name} does not support "${action}".`);
  }
  const p = getProvider(device.provider);
  const cfg = await loadConfig(device.provider);
  if (!isConnected(p, cfg)) {
    throw new HttpsError('failed-precondition', `${device.provider} is not connected.`);
  }

  const event = {
    at: FieldValue.serverTimestamp(),
    user: email,
    deviceId,
    deviceName: device.prefs?.name || device.name,
    provider: device.provider,
    action,
    value: value ?? null,
  };
  try {
    const patch = (await p.command(cfg, device, action, value, ctxFor(device.provider))) ?? {};
    const update = { lastCommandAt: FieldValue.serverTimestamp() };
    for (const [k, v] of Object.entries(patch)) update[`state.${k}`] = v;
    await ref.update(update);
    await db.collection('events').add({ ...event, ok: true });
    return { ok: true, state: patch };
  } catch (e) {
    logger.warn(`command ${action} on ${deviceId} failed`, e);
    await db.collection('events').add({ ...event, ok: false, error: e.message });
    if (e instanceof HttpsError) throw e;
    throw new HttpsError(e.status === 401 ? 'failed-precondition' : 'unavailable', e.message);
  }
}
