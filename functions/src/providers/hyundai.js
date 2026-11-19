// Hyundai via the Pleos Vehicle Data API (EU Data Act) — read-only, Europe only.
// Access: https://document.pleos.ai/en/api-reference/vehicle-data-api/getting-started/api-access-request
// Auth: OAuth 2.0 client credentials (client ID/secret from Pleos), run inside this module; no browser sign-in.
// UNVERIFIED: the default URLs, paths and response field names below could not be checked without
// Pleos approval. Both URLs can be overridden in the Hyundai card (endpoint, tokenUrl).
import { logger } from 'firebase-functions';
import { fetchJson, ProviderError } from '../lib/http.js';
import { requestToken, tokenPatch } from '../lib/oauth.js';

const DEFAULT_API = 'https://api.pleos.ai/vehicle-data/v1';
const DEFAULT_TOKEN_URL = 'https://auth.pleos.ai/oauth2/token';

const base = (cfg) => (cfg.endpoint || DEFAULT_API).replace(/\/$/, '');

// Firestore rejects `undefined`; drop empty values recursively.
const clean = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v]),
  );

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const first = (...vals) => vals.find((v) => v !== undefined && v !== null);

/** Client-credentials token, cached in the integration doc (accessToken/expiresAt never reach the browser). */
async function token(cfg, ctx) {
  if (cfg.accessToken && cfg.expiresAt && cfg.expiresAt > Date.now() + 60_000) return cfg.accessToken;
  let tok;
  try {
    tok = await requestToken({ tokenUrl: cfg.tokenUrl || DEFAULT_TOKEN_URL, basicAuth: false }, cfg, { grant_type: 'client_credentials' });
  } catch (e) {
    if (e.status === 400 || e.status === 401 || e.status === 403) {
      throw new ProviderError('Hyundai (Pleos) rejected the client ID/secret.', 401);
    }
    throw e;
  }
  const patch = tokenPatch(tok);
  await ctx.saveConfig(patch);
  Object.assign(cfg, patch);
  return cfg.accessToken;
}

const CHARGING = { CHARGING: 'CHARGING', COMPLETE: 'DONE', DONE: 'DONE', FINISHED: 'DONE', IDLE: 'IDLE', NOT_CHARGING: 'IDLE', DISCONNECTED: 'IDLE' };

/** Maps a vehicle status response onto the Car tab state keys, keeping only what it has. */
export function vehicleState(s) {
  const d = s?.data ?? s ?? {};
  const state = {};
  state.batteryPercent = num(first(d.batteryPercent, d.soc, d.stateOfCharge, d.battery?.level));
  state.rangeKm = num(first(d.rangeKm, d.range, d.electricRange, d.drivingRange));
  const charging = first(d.charging, d.chargingStatus, d.chargingState);
  if (typeof charging === 'boolean') state.charging = charging ? 'CHARGING' : 'IDLE';
  else if (charging != null) {
    const c = String(charging).toUpperCase();
    state.charging = CHARGING[c] ?? c;
  }
  state.odometerKm = num(first(d.odometerKm, d.odometer, d.mileage));
  const locked = first(d.locked, d.doorLock, d.doorsLocked);
  if (typeof locked === 'boolean') state.locked = locked;
  const loc = first(d.location, d.position, d.gps);
  const lat = num(first(loc?.lat, loc?.latitude));
  const lon = num(first(loc?.lon, loc?.lng, loc?.longitude));
  if (lat != null && lon != null) {
    state.location = { lat, lon, heading: num(loc.heading), at: first(loc.at, loc.timestamp) };
  }
  state.reportedAt = first(d.reportedAt, d.timestamp, d.lastUpdated);
  return clean(state);
}

export default {
  id: 'hyundai',
  requiredConfig: ['clientId', 'clientSecret', 'vins'],
  configFields: ['clientId', 'clientSecret', 'vins', 'endpoint', 'tokenUrl'],

  async listDevices(cfg, ctx) {
    // The Data Act API is keyed by VIN, so VINs are required.
    const vins = (cfg.vins ?? '').split(/[\s,]+/).map((v) => v.trim().toUpperCase()).filter(Boolean);
    if (vins.length === 0) throw new ProviderError('Enter your Hyundai VIN in the Hyundai card and save.', 400);
    const h = { Authorization: `Bearer ${await token(cfg, ctx)}` };
    const results = await Promise.allSettled(vins.map((vin) => fetchJson(`${base(cfg)}/vehicles/${vin}/status`, { headers: h })));
    if (results.every((r) => r.status === 'rejected')) {
      const e = results[0].reason;
      if (e?.status === 401 || e?.status === 403) throw new ProviderError('Hyundai (Pleos) refused access to this VIN.', 401);
      throw e;
    }
    return results.map((r, i) => {
      const vin = vins[i];
      if (r.status === 'rejected') logger.info(`hyundai ${vin} unavailable: ${r.reason?.message}`);
      const s = r.status === 'fulfilled' ? r.value : null;
      const d = s?.data ?? s ?? {};
      return {
        providerId: vin,
        name: String(first(d.name, d.nickname, d.model) || `Hyundai ${vin.slice(-6)}`),
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
    throw new ProviderError('The Hyundai integration is read-only.', 400);
  },
};
