// BYD — read-only car status through a gateway the user runs or subscribes to.
// Unofficial / best-effort: BYD has no public owner API; this module never signs in to BYD's
// private app API with account credentials.
// Gateway contract (e.g. a self-hosted bridge or an aggregator adapter):
//   GET {endpoint}/vehicles              -> [{ vin, name?, model? }]   (skipped when VINs are configured)
//   GET {endpoint}/vehicles/{vin}/status -> flat object: batteryPercent|soc, rangeKm|range,
//       charging, odometerKm|mileage, locked, doorsOpen[], windowsOpen[], location{lat,lon,heading,at}, reportedAt
//   Both requests send `Authorization: Bearer {apiKey}`.
import { logger } from 'firebase-functions';
import { fetchJson, ProviderError } from '../lib/http.js';

const BRAND = 'BYD';

// Firestore rejects `undefined`; drop empty values recursively.
const clean = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v]),
  );

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const first = (...vals) => vals.find((v) => v !== undefined && v !== null);
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : undefined);

async function call(cfg, path) {
  const base = String(cfg.endpoint ?? '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) throw new ProviderError(`${BRAND} gateway URL must start with http:// or https://`, 400);
  try {
    return await fetchJson(`${base}${path}`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new ProviderError(`The ${BRAND} gateway rejected the API key.`, 401);
    throw e;
  }
}

/** Copies the known keys of a gateway status object onto the Car tab state keys. */
export function vehicleState(s) {
  const state = {};
  state.batteryPercent = num(first(s?.batteryPercent, s?.soc));
  state.rangeKm = num(first(s?.rangeKm, s?.range));
  if (typeof s?.charging === 'boolean') state.charging = s.charging ? 'CHARGING' : 'IDLE';
  else if (s?.charging != null) state.charging = String(s.charging).toUpperCase();
  state.odometerKm = num(first(s?.odometerKm, s?.odometer, s?.mileage));
  if (typeof s?.locked === 'boolean') state.locked = s.locked;
  state.doorsOpen = list(s?.doorsOpen);
  state.windowsOpen = list(s?.windowsOpen);
  const loc = s?.location;
  const lat = num(first(loc?.lat, loc?.latitude));
  const lon = num(first(loc?.lon, loc?.lng, loc?.longitude));
  if (lat != null && lon != null) state.location = { lat, lon, heading: num(loc.heading), at: loc.at };
  if (s?.reportedAt) state.reportedAt = String(s.reportedAt);
  return clean(state);
}

export default {
  id: 'byd',
  requiredConfig: ['endpoint', 'apiKey'],
  configFields: ['endpoint', 'apiKey', 'vins'],

  async listDevices(cfg) {
    let cars = (cfg.vins ?? '').split(/[\s,]+/).map((v) => v.trim().toUpperCase()).filter(Boolean).map((vin) => ({ vin }));
    if (cars.length === 0) {
      const r = await call(cfg, '/vehicles');
      cars = (Array.isArray(r) ? r : r?.vehicles ?? r?.data ?? []).filter((v) => v?.vin);
    }
    const results = await Promise.allSettled(cars.map((c) => call(cfg, `/vehicles/${encodeURIComponent(c.vin)}/status`)));
    if (results.length && results.every((r) => r.status === 'rejected')) throw results[0].reason;
    return results.map((r, i) => {
      const { vin, name, model } = cars[i];
      if (r.status === 'rejected') logger.info(`byd ${vin} unavailable: ${r.reason?.message}`);
      const s = r.status === 'fulfilled' ? r.value : null;
      return {
        providerId: vin,
        name: String(first(s?.name, name, s?.model, model) || `${BRAND} ${vin.slice(-6)}`),
        type: 'vehicle',
        online: r.status === 'fulfilled',
        state: s ? vehicleState(s) : {},
        capabilities: [], // read-only
        meta: { vin },
        suggestedRoom: 'Garage',
      };
    });
  },

  async command() {
    throw new ProviderError(`The ${BRAND} integration is read-only.`, 400);
  },
};
