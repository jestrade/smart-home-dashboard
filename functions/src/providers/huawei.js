// Huawei FusionSolar plants via the FusionSolar Northbound (thirdData) API (read-only).
// A company admin creates the API user in FusionSolar: System → Company Management → Northbound Management.
// Login: POST /thirdData/login {userName, systemCode}; the session token comes back in the
// `xsrf-token` response header (or the XSRF-TOKEN cookie) and is sent as an `XSRF-TOKEN` header.
// Only one API session per user is allowed and every interface has a per-minute call limit, so the
// token is cached in the (server-only) integration doc and calls are spaced out.
// unverified: endpoint paths, field names and failCodes come from secondary sources, not the
// official Northbound Interface Reference.
import { logger } from 'firebase-functions';
import { fetchJson, ProviderError } from '../lib/http.js';

const DEFAULT_API = 'https://eu5.fusionsolar.huawei.com';
const TOKEN_TTL_MS = 25 * 60_000;
const DEV_IDS_TTL_MS = 24 * 3600_000;
const PAUSE_MS = 1100;
const FAIL_RELOGIN = 305; // USER_MUST_RELOGIN
const FAIL_RATE_LIMIT = 407; // ACCESS_FREQUENCY_IS_TOO_HIGH

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POWER = { W: 0.001, kW: 1, MW: 1000, GW: 1e6 };
const ENERGY = { Wh: 0.001, kWh: 1, MWh: 1000, GWh: 1e6 };
const scaled = (table) => (v, unit, fallback) => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return undefined;
  return Math.round(Number(v) * (table[unit] ?? table[fallback] ?? 1) * 1000) / 1000;
};
/** Pure: a power value in `unit` (W | kW | MW | GW) as kW. */
export const toKw = scaled(POWER);
/** Pure: an energy value in `unit` (Wh | kWh | MWh | GWh) as kWh. */
export const toKwh = scaled(ENERGY);
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

const clean = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v]),
  );

async function optional(label, fn) {
  try {
    return await fn();
  } catch (e) {
    logger.info(`huawei ${label} unavailable: ${e.message}`);
    return null;
  }
}

// unverified: real_health_state 1 = disconnected, 2 = faulty, 3 = healthy.
const HEALTH = { 1: ['Disconnected', 'offline'], 2: ['Faulty', 'alarm'], 3: ['Healthy', 'ok'] };
/** Pure: FusionSolar real_health_state → [statusLabel, solarStatus]. */
export function huaweiHealth(code) {
  return HEALTH[num(code)] ?? ['Unknown', 'offline'];
}

/** Pure: the XSRF token from a login response's headers (`xsrf-token`, else the XSRF-TOKEN cookie). */
export function readXsrfToken(headers) {
  const direct = headers?.get?.('xsrf-token');
  if (direct) return direct;
  const cookie = headers?.get?.('set-cookie') ?? '';
  return cookie.match(/XSRF-TOKEN=([^;,\s]+)/i)?.[1] ?? null;
}

const baseUrl = (cfg) => (cfg.endpoint || DEFAULT_API).trim().replace(/\/+$/, '');

// The session token comes back as a response header, so fetchJson hands the headers to onHeaders.
async function login(cfg, ctx, session) {
  let headers = null;
  let data;
  try {
    data = await fetchJson(`${baseUrl(cfg)}/thirdData/login`, {
      method: 'POST',
      body: { userName: cfg.userName, systemCode: cfg.systemCode },
      onHeaders: (h) => (headers = h),
    });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new ProviderError('Huawei FusionSolar rejected the API user name or system code.', 401);
    if (e instanceof ProviderError && e.status) throw new ProviderError(`Huawei FusionSolar login failed (${e.status}).`, e.status);
    throw new ProviderError(`Huawei FusionSolar login failed: ${e.message}`, 502);
  }
  if (data?.success === false) {
    if (num(data.failCode) === FAIL_RATE_LIMIT) throw new ProviderError('Huawei FusionSolar rate limit (407) on login.', 429);
    throw new ProviderError('Huawei FusionSolar rejected the API user name or system code.', 401);
  }
  const token = readXsrfToken(headers);
  if (!token) throw new ProviderError('Huawei FusionSolar login returned no session token.', 401);
  session.token = token;
  session.at = Date.now();
  await ctx?.saveConfig?.({ xsrfToken: token, xsrfAt: session.at });
  await sleep(PAUSE_MS);
}

async function call(cfg, ctx, session, path, body, { relogged = false } = {}) {
  if (!session.token || Date.now() - (session.at ?? 0) > TOKEN_TTL_MS) await login(cfg, ctx, session);
  let r;
  try {
    r = await fetchJson(`${baseUrl(cfg)}${path}`, { method: 'POST', headers: { 'XSRF-TOKEN': session.token }, body });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new ProviderError('Huawei FusionSolar rejected the API session.', 401);
    throw e;
  }
  await sleep(PAUSE_MS); // per-interface frequency limits
  if (r?.success === false) {
    const code = num(r.failCode);
    if (code === FAIL_RELOGIN) {
      if (relogged) throw new ProviderError('Huawei FusionSolar keeps asking to log in again; check the API user.', 401);
      session.token = null;
      return call(cfg, ctx, session, path, body, { relogged: true });
    }
    if (code === FAIL_RATE_LIMIT) throw new ProviderError(`Huawei FusionSolar rate limit (407) on ${path}.`, 429);
    throw new ProviderError(`Huawei FusionSolar ${path}: ${r.message ?? r.data ?? 'error'} (${r.failCode})`, 400);
  }
  return r?.data;
}

/** Plant list: the current /thirdData/stations, else the legacy getStationList. */
async function listPlants(cfg, ctx, session) {
  let rows;
  try {
    const d = await call(cfg, ctx, session, '/thirdData/stations', { pageNo: 1 });
    rows = d?.list ?? (Array.isArray(d) ? d : null);
  } catch (e) {
    if (e.status === 401 || e.status === 429) throw e;
    logger.info(`huawei stations unavailable, trying getStationList: ${e.message}`);
  }
  if (!rows) {
    const d = await call(cfg, ctx, session, '/thirdData/getStationList', {});
    rows = Array.isArray(d) ? d : d?.list ?? [];
  }
  return rows
    .map((s) => ({
      code: s.plantCode ?? s.stationCode,
      name: s.plantName ?? s.stationName,
      // unverified: /stations reports capacity in kW, the legacy getStationList in MW.
      capacityKwp: s.capacity != null ? toKw(s.capacity, s.plantCode ? 'kW' : 'MW') : undefined,
    }))
    .filter((s) => s.code);
}

/** Inverter device ids per station, cached for a day to save a call on most syncs. */
async function inverterIds(cfg, ctx, session, codes) {
  const cached = cfg.devIds;
  if (cached?.at && Date.now() - cached.at < DEV_IDS_TTL_MS && cached.codes === codes.join(',')) return cached.list;
  const d = await call(cfg, ctx, session, '/thirdData/getDevList', { stationCodes: codes.join(',') });
  const list = (Array.isArray(d) ? d : [])
    .filter((x) => num(x.devTypeId) === 1) // 1 = string inverter
    .map((x) => ({ id: String(x.id), sn: x.esnCode, model: x.invType ?? x.model, station: x.stationCode }));
  await ctx?.saveConfig?.({ devIds: { at: Date.now(), codes: codes.join(','), list } });
  return list;
}

export default {
  id: 'huawei',
  requiredConfig: ['userName', 'systemCode'],
  configFields: ['userName', 'systemCode', 'endpoint'],

  async listDevices(cfg, ctx) {
    const session = { token: cfg.xsrfToken ?? null, at: num(cfg.xsrfAt) ?? 0 };
    const plants = await listPlants(cfg, ctx, session);
    if (plants.length === 0) throw new ProviderError('No solar plants found on this Huawei FusionSolar account.', 404);
    const codes = plants.map((p) => p.code);

    // One call for every plant: today's, this month's and lifetime energy plus health.
    const kpi = (await call(cfg, ctx, session, '/thirdData/getStationRealKpi', { stationCodes: codes.join(',') })) ?? [];
    const kpiBy = Object.fromEntries((Array.isArray(kpi) ? kpi : []).map((k) => [k.stationCode, k.dataItemMap ?? {}]));

    // Inverters (optional): live power per inverter, summed into the plant's power.
    const invBy = {};
    await optional('inverters', async () => {
      const devs = await inverterIds(cfg, ctx, session, codes);
      if (devs.length === 0) return;
      const real = (await call(cfg, ctx, session, '/thirdData/getDevRealKpi', { devIds: devs.map((x) => x.id).join(','), devTypeId: 1 })) ?? [];
      const realBy = Object.fromEntries((Array.isArray(real) ? real : []).map((r) => [String(r.devId), r.dataItemMap ?? {}]));
      for (const dev of devs) {
        const m = realBy[dev.id] ?? {};
        (invBy[dev.station] ??= []).push(
          clean({
            sn: dev.sn,
            model: dev.model,
            state: num(m.run_state) === 1 ? 'Online' : num(m.run_state) === 0 ? 'Offline' : undefined,
            kw: toKw(m.active_power, 'kW'),
            todayKwh: toKwh(m.day_cap, 'kWh'),
            totalKwh: toKwh(m.total_cap, 'kWh'),
          }),
        );
      }
    });

    return plants.map((p) => {
      const k = kpiBy[p.code] ?? {};
      const [label, group] = huaweiHealth(k.real_health_state);
      const inverters = invBy[p.code];
      const powers = (inverters ?? []).map((x) => x.kw).filter((v) => v != null);
      const powerKw = powers.length ? Math.round(powers.reduce((a, b) => a + b, 0) * 1000) / 1000 : undefined;
      const todayKwh = toKwh(k.day_power, 'kWh');
      const monthKwh = toKwh(k.month_power, 'kWh');
      const totalKwh = toKwh(k.total_power, 'kWh');
      const state = {
        statusLabel: label,
        solarStatus: group,
        powerKw,
        capacityKwp: p.capacityKwp,
        todayKwh,
        monthKwh,
        totalKwh,
        periods: { day: { producedKwh: todayKwh }, month: { producedKwh: monthKwh }, total: { producedKwh: totalKwh } },
        inverters,
      };
      return {
        providerId: String(p.code),
        name: p.name ?? `Solar plant ${p.code}`,
        type: 'solar',
        model: p.capacityKwp ? `${p.capacityKwp} kWp` : null,
        online: group !== 'offline',
        state: clean(state),
        capabilities: [],
        meta: clean({ stationId: String(p.code), capacityKwp: p.capacityKwp }),
        suggestedRoom: 'Roof',
      };
    });
  },

  async command() {
    throw new ProviderError('The Huawei FusionSolar integration is read-only.', 400);
  },
};
