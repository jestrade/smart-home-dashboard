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
  snapshot: 'snapshot',
  live: 'live',
  setPosition: 'position',
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

export const isConfigured = (p, cfg) => (p.isConfigured ? p.isConfigured(cfg) : p.requiredConfig.every((k) => cfg[k]));
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

// ---------- energy per day ----------

const HOME_TZ = process.env.HOME_TZ || 'UTC';
const localDay = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: HOME_TZ }).format(new Date(t)); // yyyy-mm-dd
const localHour = (t = Date.now()) =>
  `${localDay(t)}T${new Intl.DateTimeFormat('en-GB', { timeZone: HOME_TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t))}`; // yyyy-mm-ddTHH
const HOURS_KEPT = 7 * 24;

/**
 * Daily energy for devices that measure it. Devices with a running counter (energyTotalKwh) are
 * read at the first sync of each day; devices that only report power now (powerW) get an
 * estimate that adds up power × time between syncs. Keeps the last 31 days on the device itself.
 */
function trackEnergy(d, prev) {
  // The car's charging power is the charger's, which has its own session records.
  if (d.type === 'vehicle' || d.type === 'charger' || d.type === 'solar') return d;
  const s = d.state ?? {};
  const now = Date.now();
  const log = { starts: { ...(prev?.energyLog?.starts ?? {}) }, hourStarts: { ...(prev?.energyLog?.hourStarts ?? {}) }, estimateKwh: prev?.energyLog?.estimateKwh ?? 0, lastAt: prev?.energyLog?.lastAt, lastW: prev?.energyLog?.lastW };
  let counter = Number.isFinite(s.energyTotalKwh) ? s.energyTotalKwh : null;
  let estimated = false;
  if (counter == null && Number.isFinite(s.powerW)) {
    // Trapezoid between two readings; gaps over an hour (sync stopped, device offline) are skipped.
    const hours = log.lastAt ? (now - log.lastAt) / 3600_000 : 0;
    if (hours > 0 && hours <= 1 && Number.isFinite(log.lastW)) log.estimateKwh += (((log.lastW + s.powerW) / 2) * hours) / 1000;
    log.estimateKwh = Math.round(log.estimateKwh * 10000) / 10000;
    log.lastAt = now;
    log.lastW = s.powerW;
    counter = log.estimateKwh;
    estimated = true;
  }
  if (counter == null) return d;
  const today = localDay(now);
  if (log.starts[today] == null) log.starts[today] = counter;
  const days = Object.keys(log.starts).sort().slice(-31);
  log.starts = Object.fromEntries(days.map((k) => [k, log.starts[k]]));
  const round = (x) => Math.max(0, Math.round(x * 1000) / 1000);
  const energyDays = days.map((day, i) => ({ day, kwh: round((i + 1 < days.length ? log.starts[days[i + 1]] : counter) - log.starts[day]) }));
  // The same per hour (the counter at the first sync of each hour), for the last 7 days.
  const hour = localHour(now);
  if (log.hourStarts[hour] == null) log.hourStarts[hour] = counter;
  const hours = Object.keys(log.hourStarts).sort().slice(-HOURS_KEPT);
  log.hourStarts = Object.fromEntries(hours.map((k) => [k, log.hourStarts[k]]));
  const energyHours = hours.map((h, i) => ({ h, kwh: round((i + 1 < hours.length ? log.hourStarts[hours[i + 1]] : counter) - log.hourStarts[h]) }));
  return {
    ...d,
    state: { ...s, todayKwh: energyDays.at(-1).kwh, energyDays, energyHours, ...(estimated ? { energyEstimated: true } : {}) },
    energyLog: log,
  };
}

export async function syncProvider(id) {
  const p = getProvider(id);
  const cfg = await loadConfig(id);
  if (!isConnected(p, cfg)) {
    await writeStatus(id, cfg);
    return { provider: id, skipped: true };
  }
  try {
    const existing = await db.collection('devices').where('provider', '==', id).get();
    const previous = new Map(existing.docs.map((doc) => [doc.id, doc.data()]));
    const devices = (await p.listDevices(cfg, ctxFor(id))).map((d) => trackEnergy(d, previous.get(deviceDocId(id, d.providerId))));
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

// ---------- energy on a chosen day ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TODAY_CACHE_MS = 10 * 60 * 1000;

/**
 * The solar plant's power curve and balance for one day. Past days never change, so they are kept
 * in energyDays/* after the first request; today's is kept for 10 minutes. This keeps calls to the
 * provider (and function time) low however often the page asks.
 */
export async function energyDay(date) {
  if (!DAY_RE.test(date ?? '')) throw Object.assign(new Error('date must be yyyy-mm-dd.'), { status: 400 });
  const today = localDay();
  const oldest = localDay(Date.now() - 2 * 366 * 86400_000);
  if (date > today || date < oldest) throw Object.assign(new Error('That date is out of range.'), { status: 400 });

  const snap = await db.collection('devices').where('type', '==', 'solar').get();
  const stations = [];
  for (const doc of snap.docs) {
    const dev = doc.data();
    if (dev.stale) continue;
    const p = getProvider(dev.provider);
    if (!p.energyDay) continue;
    const ref = db.doc(`energyDays/${doc.id}_${date}`);
    const cached = (await ref.get()).data();
    const fresh = cached && (date < today ? cached.complete : Date.now() - (cached.savedAt ?? 0) < TODAY_CACHE_MS);
    if (fresh) {
      stations.push({ deviceId: doc.id, curve: cached.curve ?? [], balance: cached.balance ?? null });
      continue;
    }
    const cfg = await loadConfig(dev.provider);
    if (!isConnected(p, cfg)) continue;
    const r = await p.energyDay(cfg, dev, date);
    // A past day is complete once the plant has reported it; an empty answer may be a hiccup.
    await ref.set({ curve: r.curve, balance: r.balance, savedAt: Date.now(), complete: date < today && r.curve.length > 0 });
    stations.push({ deviceId: doc.id, curve: r.curve, balance: r.balance });
  }
  return { date, today, stations };
}
