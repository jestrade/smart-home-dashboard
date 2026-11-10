// Wallbox (wallbox.com) chargers through the cloud API used by the myWallbox app.
// Unofficial API, documented at https://github.com/SKB-CGN/wallbox
// Read-only. Works only with an email/password account (not Google/Apple sign-in).
import { logger } from 'firebase-functions';
import { fetchJson, ProviderError } from '../lib/http.js';

const API = 'https://api.wall-box.com';
const USER_API = 'https://user-api.wall-box.com';

export const STATUS = {
  0: ['Disconnected', 'idle'],
  14: ['Error', 'error'],
  15: ['Error', 'error'],
  161: ['Ready', 'ready'],
  162: ['Ready', 'ready'],
  163: ['Disconnected', 'idle'],
  164: ['Waiting – remove plug', 'waiting'],
  165: ['Locked', 'locked'],
  166: ['Updating', 'waiting'],
  177: ['Scheduled', 'waiting'],
  178: ['Paused', 'paused'],
  179: ['Scheduled', 'waiting'],
  180: ['Waiting for car demand', 'waiting'],
  181: ['Waiting for car demand', 'waiting'],
  182: ['Paused', 'paused'],
  183: ['Waiting – power sharing', 'waiting'],
  184: ['Waiting – power sharing', 'waiting'],
  185: ['Waiting – power boost', 'waiting'],
  186: ['Waiting – power boost', 'waiting'],
  187: ['Waiting – MID failed', 'error'],
  188: ['Waiting – MID margin exceeded', 'error'],
  189: ['Waiting – Eco-Smart', 'waiting'],
  193: ['Charging', 'charging'],
  194: ['Charging', 'charging'],
  195: ['Charging', 'charging'],
  196: ['Discharging', 'charging'],
  209: ['Locked', 'locked'],
  210: ['Locked – car connected', 'locked'],
};

const tokenCache = new Map(); // email -> { token, expiresAt }

async function getToken(cfg) {
  const cached = tokenCache.get(cfg.email);
  if (cached && cached.expiresAt > Date.now() + 5_000) return cached.token;
  const basic = 'Basic ' + Buffer.from(`${cfg.email}:${cfg.password}`).toString('base64');
  let token;
  let ttlMs = 60_000;
  try {
    // Current endpoint used by the myWallbox app.
    const r = await fetchJson(`${USER_API}/users/signin`, { method: 'GET', headers: { Authorization: basic, Partner: 'wallbox' } });
    token = r?.data?.attributes?.token;
    if (r?.data?.attributes?.ttl) ttlMs = Math.max(30_000, r.data.attributes.ttl * 1000 - Date.now());
  } catch (e) {
    logger.info(`wallbox signin endpoint failed (${e.status}), trying legacy`);
  }
  if (!token) {
    // Legacy endpoint from the SKB-CGN documentation.
    try {
      const r = await fetchJson(`${API}/auth/token/user`, { method: 'POST', headers: { Authorization: basic } });
      token = r?.jwt;
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        throw new ProviderError(
          'Wallbox rejected the email or password. Check them by logging in to my.wallbox.com; if your account uses Google or Apple sign-in, set a password there first.',
          401,
        );
      }
      throw new ProviderError(`Wallbox sign-in failed: ${e.message}`, 502);
    }
  }
  if (!token) throw new ProviderError('Wallbox sign-in returned no token.', 401);
  tokenCache.set(cfg.email, { token, expiresAt: Date.now() + Math.min(ttlMs, 10 * 60_000) });
  return token;
}

async function call(cfg, path, opts = {}) {
  const run = async () =>
    fetchJson(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${await getToken(cfg)}`, ...(opts.headers ?? {}) } });
  try {
    return await run();
  } catch (e) {
    if (e.status !== 401) throw e;
    tokenCache.delete(cfg.email); // expired token: retry once
    return run();
  }
}

const isNumeric = (v) => /^\d+$/.test(String(v));

/** Numeric charger IDs. Accepts configured numeric IDs/serials, or text uids that are resolved via the account's groups. */
async function chargerIds(cfg) {
  const configured = (cfg.chargerIds ?? '').split(/[\s,]+/).filter(Boolean);
  if (configured.length && configured.every(isNumeric)) return configured;

  const r = await call(cfg, '/v3/chargers/groups');
  const chargers = (r?.result?.groups ?? []).flatMap((g) => g.chargers ?? []);
  const numericId = (c) => [c.id, c.chargerId, c.serialNumber].find(isNumeric);
  if (configured.length === 0) return chargers.map(numericId).filter(Boolean).map(String);

  // Map each configured value (numeric id, serial or text uid) to the numeric id.
  return configured.map((want) => {
    if (isNumeric(want)) return want;
    const match = chargers.find((c) => [c.uid, c.uniqueIdentifier, c.id].map(String).includes(want));
    if (!match || !numericId(match)) {
      throw new ProviderError(
        `Wallbox charger "${want}" was not found on this account. Use the charger's serial number, or clear the Charger ID field to detect it automatically.`,
        404,
      );
    }
    return String(numericId(match));
  });
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

function parseSessions(raw) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  return rows
    .map((row) => {
      const a = row.attributes ?? row;
      const energy = num(a.energy ?? a.energy_total ?? a.green_energy);
      return {
        start: num(a.start ?? a.start_time),
        end: num(a.end ?? a.end_time),
        // The API reports Wh for sessions; values under 1000 are already kWh.
        energyKwh: energy == null ? undefined : energy > 1000 ? energy / 1000 : energy,
        durationS: num(a.time ?? a.charging_time),
        cost: num(a.cost),
        rangeKm: num(a.range),
      };
    })
    .filter((s) => s.start)
    .sort((x, y) => y.start - x.start);
}

const clean = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v]),
  );

async function chargerState(cfg, id) {
  const now = Math.floor(Date.now() / 1000);
  const [statusRes, sessionsRes] = await Promise.allSettled([
    call(cfg, `/chargers/status/${id}`),
    call(cfg, `/v4/sessions/stats?charger=${id}&start_date=${now - 30 * 86400}&end_date=${now}`),
  ]);
  if (statusRes.status === 'rejected') throw statusRes.reason;
  const s = statusRes.value;
  const c = s.config_data ?? {};
  const [label, group] = STATUS[s.status_id] ?? [`Status ${s.status_id}`, 'idle'];

  const sessions = sessionsRes.status === 'fulfilled' ? parseSessions(sessionsRes.value) : [];
  if (sessionsRes.status === 'rejected') logger.info(`wallbox sessions unavailable: ${sessionsRes.reason?.message}`);
  const sum = (k) => sessions.reduce((t, x) => t + (x[k] ?? 0), 0);

  const state = {
    statusCode: s.status_id,
    statusLabel: label,
    statusGroup: group,
    on: group === 'charging',
    locked: c.locked === 1,
    chargingPowerKw: num(s.charging_power),
    chargingSpeed: num(s.charging_speed),
    maxChargingCurrent: num(c.max_charging_current),
    maxAvailableCurrent: num(c.max_available_current ?? s.max_available_power),
    session: {
      energyKwh: num(s.added_energy),
      greenEnergyKwh: num(s.added_green_energy),
      gridEnergyKwh: num(s.added_grid_energy),
      rangeKm: num(s.added_range),
      durationS: num(s.charging_time),
      cost: num(s.cost),
      finished: s.finished,
    },
    stateOfCharge: num(s.state_of_charge),
    currency: c.currency?.symbol ?? c.currency?.code,
    energyPrice: num(c.energy_price),
    ecoSmart: c.ecosmart ? { enabled: Boolean(c.ecosmart.enabled), mode: c.ecosmart.mode === 1 ? 'Full green' : 'Eco', percentage: num(c.ecosmart.percentage) } : undefined,
    powerBoost: c.home_sharing === 1,
    autoLock: c.auto_lock === 1,
    autoLockMinutes: c.auto_lock_time ? Math.round(c.auto_lock_time / 60) : undefined,
    software: c.software ? { current: c.software.currentVersion, latest: c.software.latestVersion, updateAvailable: Boolean(c.software.updateAvailable) } : undefined,
    serial: c.serial_number,
    partNumber: c.part_number,
    timezone: c.timezone,
    lastSync: s.last_sync,
    sessions: sessions.slice(0, 15),
    last30: sessions.length ? { sessions: sessions.length, energyKwh: sum('energyKwh'), cost: sum('cost'), durationS: sum('durationS') } : undefined,
  };

  return {
    providerId: String(id),
    name: s.name ?? c.name ?? `Wallbox ${id}`,
    type: 'charger',
    model: c.part_number ?? null,
    online: c.available !== 0 && s.status_id !== 0,
    state: clean(state),
    capabilities: [], // read-only
    meta: { chargerId: String(id) },
    suggestedRoom: 'Garage',
  };
}

export default {
  id: 'wallbox',
  requiredConfig: ['email', 'password'],
  configFields: ['email', 'password', 'chargerIds'],

  async listDevices(cfg) {
    const ids = await chargerIds(cfg);
    if (ids.length === 0) throw new ProviderError('No chargers found on this Wallbox account.', 404);
    return Promise.all(ids.map((id) => chargerState(cfg, id)));
  },

  async command() {
    throw new ProviderError('The Wallbox integration is read-only.', 400);
  },
};
