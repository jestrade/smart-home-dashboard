// Growatt solar plants via the Growatt OpenAPI v1 (read-only).
// Get an API token from the Growatt OSS / ShineServer account; it is sent as a `token` header.
// The host is regional: openapi.growatt.com (default), openapi-us, openapi-au or openapi-cn.
// unverified: the plant/data and device/list field names and the error codes come from the
// growattServer open_api_v1 client, not from an official Growatt reference.
import { logger } from 'firebase-functions';
import { fetchJson, ProviderError } from '../lib/http.js';

const DEFAULT_API = 'https://openapi.growatt.com';
const PAUSE_MS = 1000;
// unverified: 10011 / 10012 are the token / permission errors.
const AUTH_ERRORS = new Set([10011, 10012]);

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
    logger.info(`growatt ${label} unavailable: ${e.message}`);
    return null;
  }
}

// unverified: plant status 1 = online, 0 = offline, anything else = fault.
const STATUS = { 1: ['Online', 'ok'], 0: ['Offline', 'offline'] };
/** Pure: Growatt plant status → [statusLabel, solarStatus]. */
export function growattStatus(code) {
  const n = num(code);
  if (n == null) return ['Unknown', 'offline'];
  return STATUS[n] ?? ['Fault', 'alarm'];
}

/** Pure: Growatt's "yyyy-mm-dd hh:mm:ss" (plant-local time, no zone) as an ISO-ish string. */
function reportedAt(v) {
  const m = String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  return m ? `${m[1]}T${m[2]}` : undefined;
}

const baseUrl = (cfg) => `${(cfg.endpoint || DEFAULT_API).trim().replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/`;

async function call(cfg, path) {
  let r;
  try {
    r = await fetchJson(`${baseUrl(cfg)}${path}`, { headers: { token: cfg.token } });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new ProviderError('Growatt rejected the API token.', 401);
    throw e;
  }
  await sleep(PAUSE_MS);
  const code = num(r?.error_code);
  if (code != null && code !== 0) {
    const msg = String(r?.error_msg ?? 'error');
    if (AUTH_ERRORS.has(code) || /token|permission/i.test(msg)) throw new ProviderError('Growatt rejected the API token.', 401);
    throw new ProviderError(`Growatt ${path.split('?')[0]}: ${msg} (${code})`, 400);
  }
  return r?.data;
}

async function plantState(cfg, plant) {
  const id = plant.plant_id;
  const d = (await call(cfg, `plant/data?plant_id=${encodeURIComponent(id)}`)) ?? {};

  const dev = await optional('device/list', () => call(cfg, `device/list?plant_id=${encodeURIComponent(id)}&page=1&perpage=20`));
  const inverters = (dev?.devices ?? []).map((x) => clean({ sn: x.device_sn, model: x.model ?? x.type }));

  const [label, group] = growattStatus(plant.status);
  const capacityKwp = toKw(plant.peak_power, 'kW');
  const todayKwh = toKwh(d.today_energy, 'kWh');
  const monthKwh = toKwh(d.monthly_energy, 'kWh');
  const yearKwh = toKwh(d.yearly_energy, 'kWh');
  const totalKwh = toKwh(d.total_energy, 'kWh');

  const state = {
    statusLabel: label,
    solarStatus: group,
    powerKw: toKw(d.current_power, 'W'),
    capacityKwp,
    todayKwh,
    monthKwh,
    yearKwh,
    totalKwh,
    periods: { day: { producedKwh: todayKwh }, month: { producedKwh: monthKwh }, year: { producedKwh: yearKwh }, total: { producedKwh: totalKwh } },
    inverters: inverters.length ? inverters : undefined,
    reportedAt: reportedAt(d.last_update_time),
  };

  return {
    providerId: String(id),
    name: plant.name ?? `Solar plant ${id}`,
    type: 'solar',
    model: capacityKwp ? `${capacityKwp} kWp` : null,
    online: group !== 'offline',
    state: clean(state),
    capabilities: [],
    meta: clean({ stationId: String(id), capacityKwp }),
    suggestedRoom: 'Roof',
  };
}

export default {
  id: 'growatt',
  requiredConfig: ['token'],
  configFields: ['token', 'endpoint'],

  async listDevices(cfg) {
    const list = await call(cfg, 'plant/list?page=1&perpage=20');
    const plants = (list?.plants ?? []).filter((p) => p?.plant_id != null);
    if (plants.length === 0) throw new ProviderError('No solar plants found on this Growatt account.', 404);
    const out = [];
    for (const p of plants) out.push(await plantState(cfg, p)); // sequential: API rate limits
    return out;
  },

  async command() {
    throw new ProviderError('The Growatt integration is read-only.', 400);
  },
};
