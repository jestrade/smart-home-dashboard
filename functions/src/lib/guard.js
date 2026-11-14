// Per-IP protection for the functions: a rate limit, strikes for suspicious requests, and a
// blocklist. Firebase has no firewall in front of Cloud Functions, so a blocked IP still reaches
// the function, but it is turned away before any real work (provider calls, Firestore reads).
//
// Costs are kept low on purpose:
// - counting happens in memory, per instance (at most a few instances run at once);
// - the blocklist is one Firestore document, re-read at most once a minute per instance;
// - security events are written at most once a minute per IP, and at most EVENTS_PER_MIN per instance.
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db, FieldValue } from './admin.js';

const WINDOW_MS = 60_000;
/** Requests per minute per IP, by endpoint. */
export const LIMITS = { bridge: 90, smartthingsWebhook: 60, oauthCallback: 10, call: 120 };
const STRIKES_TO_BLOCK = 3; // within STRIKE_WINDOW_MS
const STRIKE_WINDOW_MS = 60 * 60_000;
const BLOCK_MS = 24 * 60 * 60_000;
const BLOCKLIST_TTL_MS = 60_000;
const EVENTS_PER_MIN = 30;
export const EVENTS_KEEP_MS = 7 * 24 * 60 * 60_000;

const BLOCKLIST = 'security/blocklist';

const hits = new Map(); // `${scope}|${ip}` -> { start, count }
const strikes = new Map(); // ip -> [timestamps]
const lastEvent = new Map(); // `${ip}|${kind}` -> time
let eventBudget = { start: 0, used: 0 };
let blocklist = { at: 0, ips: {} };
let members = { at: 0, emails: [] };

/** The household's emails (config/access), cached for a minute. */
async function isMember(req) {
  const t = req.auth?.token;
  if (!t?.email_verified || !t.email) return false;
  if (Date.now() - members.at > BLOCKLIST_TTL_MS) {
    try {
      members = { at: Date.now(), emails: (await db.doc('config/access').get()).get('emails') ?? [] };
    } catch {
      members.at = Date.now();
    }
  }
  return members.emails.includes(t.email);
}

/** The caller's IP: the first X-Forwarded-For entry (set by Google's front end), else the socket. */
export function clientIp(req) {
  const fwd = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  return (fwd || req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '').slice(0, 64);
}

/** Firestore field names cannot contain dots or slashes freely; keep the IP readable. */
const ipKey = (ip) => ip.replace(/[.:/]/g, '_');

async function blockedUntil(ip) {
  if (Date.now() - blocklist.at > BLOCKLIST_TTL_MS) {
    try {
      const snap = await db.doc(BLOCKLIST).get();
      blocklist = { at: Date.now(), ips: snap.get('ips') ?? {} };
    } catch (e) {
      logger.warn('guard: could not read the blocklist', e);
      blocklist.at = Date.now(); // fail open, try again in a minute
    }
  }
  const until = blocklist.ips[ipKey(ip)]?.until ?? 0;
  return until > Date.now() ? until : 0;
}

/** Records something worth seeing in the Security section. Never throws. */
export async function recordEvent(ip, kind, detail = {}) {
  const now = Date.now();
  const k = `${ip}|${kind}`;
  if (now - (lastEvent.get(k) ?? 0) < WINDOW_MS) return;
  if (now - eventBudget.start > WINDOW_MS) eventBudget = { start: now, used: 0 };
  if (eventBudget.used >= EVENTS_PER_MIN) return;
  eventBudget.used += 1;
  lastEvent.set(k, now);
  if (lastEvent.size > 5000) lastEvent.clear();
  try {
    await db.collection('securityEvents').add({
      ip, kind,
      path: String(detail.path ?? '').slice(0, 200) || null,
      endpoint: detail.endpoint ?? null,
      userAgent: String(detail.userAgent ?? '').slice(0, 200) || null,
      at: now,
    });
  } catch (e) {
    logger.warn('guard: could not record event', e);
  }
}

async function block(ip, reason) {
  const until = Date.now() + BLOCK_MS;
  blocklist.ips[ipKey(ip)] = { ip, until, reason };
  try {
    await db.doc(BLOCKLIST).set({ ips: { [ipKey(ip)]: { ip, until, reason, at: Date.now() } } }, { merge: true });
  } catch (e) {
    logger.warn('guard: could not store block', e);
  }
  logger.warn(`guard: blocked ${ip} for 24 h (${reason})`);
  await recordEvent(ip, 'blocked', { endpoint: reason });
}

/**
 * A suspicious request (bad token, bad signature, probing a path, not a member). Enough of them in
 * an hour blocks the IP; `instant` blocks it right away (e.g. asking for /wp-login.php).
 */
export async function strike(ip, kind, detail = {}, { instant = false } = {}) {
  const now = Date.now();
  const list = (strikes.get(ip) ?? []).filter((t) => now - t < STRIKE_WINDOW_MS);
  list.push(now);
  strikes.set(ip, list);
  if (strikes.size > 5000) strikes.clear();
  await recordEvent(ip, kind, detail);
  if (instant || list.length >= STRIKES_TO_BLOCK) await block(ip, `${kind}${detail.endpoint ? ` · ${detail.endpoint}` : ''}`);
}

function overLimit(scope, ip) {
  const now = Date.now();
  const k = `${scope}|${ip}`;
  const h = hits.get(k);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(k, { start: now, count: 1 });
    if (hits.size > 10000) hits.clear();
    return false;
  }
  h.count += 1;
  return h.count > LIMITS[scope];
}

/** Paths no part of this app ever uses: asking for one is a scan. */
const PROBE = /(\.php|\.asp|\.env|\.git|wp-|wordpress|phpmyadmin|\/admin|\/cgi-bin|\.\.\/|%2e%2e|\/etc\/passwd|\.sql|\.bak)/i;
export const isProbe = (path) => PROBE.test(String(path ?? ''));

/**
 * For HTTP functions. Returns true when the request may go on; otherwise it has already answered.
 */
export async function guardRequest(req, res, scope) {
  const ip = clientIp(req);
  const detail = { path: req.originalUrl ?? req.path, endpoint: scope, userAgent: req.headers?.['user-agent'] };
  if (await blockedUntil(ip)) {
    res.status(403).send('Forbidden');
    return false;
  }
  if (isProbe(req.originalUrl ?? req.path)) {
    await strike(ip, 'probe', detail, { instant: true });
    res.status(404).send('Not found');
    return false;
  }
  if (overLimit(scope, ip)) {
    await strike(ip, 'rate-limit', detail);
    res.set('Retry-After', '60').status(429).send('Too many requests');
    return false;
  }
  req.clientIp = ip;
  return true;
}

/**
 * For callable functions. Household members are never blocked or limited here; everyone else is,
 * including any other Google account (anyone can sign in with Google).
 */
export async function guardCall(req, name) {
  const raw = req.rawRequest ?? {};
  const ip = clientIp(raw);
  appCheckSeen(Boolean(req.app));
  if (await isMember(req)) return ip;
  if (await blockedUntil(ip)) throw new HttpsError('permission-denied', 'Forbidden');
  if (overLimit('call', ip)) {
    await strike(ip, 'rate-limit', { endpoint: name, userAgent: raw.headers?.['user-agent'] });
    throw new HttpsError('resource-exhausted', 'Too many requests');
  }
  return ip;
}

/** A callable refused the caller (not signed in / not a member): counts as a strike. */
export async function deniedCall(req, name) {
  if (await isMember(req)) return;
  const raw = req.rawRequest ?? {};
  await strike(clientIp(raw), 'denied', { endpoint: name, userAgent: raw.headers?.['user-agent'] });
}

// App Check in monitor mode: count how many calls carry a valid App Check token, so it is safe to
// see whether every real device (phone, car browser) passes before enforcing it.
let appCheck = { verified: 0, missing: 0, since: Date.now() };
function appCheckSeen(ok) {
  appCheck[ok ? 'verified' : 'missing'] += 1;
  if (appCheck.verified + appCheck.missing >= 50) flushAppCheck();
}
async function flushAppCheck() {
  const { verified, missing } = appCheck;
  appCheck = { verified: 0, missing: 0, since: Date.now() };
  try {
    await db.doc('security/appCheck').set(
      { verified: FieldValue.increment(verified), missing: FieldValue.increment(missing), updatedAt: Date.now() },
      { merge: true },
    );
  } catch (e) {
    logger.warn('guard: could not store App Check counts', e);
  }
}
export { flushAppCheck };

/** Removes an IP from the blocklist (from the Security section). */
export async function unblock(ip) {
  delete blocklist.ips[ipKey(ip)];
  strikes.delete(ip);
  await db.doc(BLOCKLIST).set({ ips: { [ipKey(ip)]: FieldValue.delete() } }, { merge: true });
}

/** Drops expired blocks and old events. Run from the scheduled sync. */
export async function cleanupSecurity() {
  const now = Date.now();
  const snap = await db.doc(BLOCKLIST).get();
  const expired = Object.entries(snap.get('ips') ?? {}).filter(([, v]) => !(v?.until > now)).map(([k]) => k);
  if (expired.length) await db.doc(BLOCKLIST).set({ ips: Object.fromEntries(expired.map((k) => [k, FieldValue.delete()])) }, { merge: true });
  const old = await db.collection('securityEvents').where('at', '<', now - EVENTS_KEEP_MS).limit(400).get();
  if (!old.empty) {
    const b = db.batch();
    old.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  await flushAppCheck();
}
