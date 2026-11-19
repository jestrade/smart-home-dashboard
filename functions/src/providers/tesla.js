// Tesla Fleet API — read-only (battery, charging, range, doors, windows, tyre warnings, location).
// Docs: https://developer.tesla.com/docs/fleet-api
// vehicle_data reference: https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints#vehicle-data
// Field names below follow that reference; they could not be checked against a live car.
// Sleeping cars are never woken: waking is a command and Fleet API calls are billed.
import { logger } from 'firebase-functions';
import { fetchJson, ProviderError } from '../lib/http.js';
import { ensureAccessToken } from '../lib/oauth.js';

const AUTH = 'https://auth.tesla.com/oauth2/v3';
// The token endpoint is shared by every region.
const TOKEN_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token';
// North America / Asia-Pacific and Europe. China: https://fleet-api.prd.cn.vn.cloud.tesla.cn
const DEFAULT_API = 'https://fleet-api.prd.na.vn.cloud.tesla.com';

// Read-only scopes. vehicle_cmds / vehicle_charging_cmds are deliberately left out.
const DEFAULT_SCOPES = 'openid offline_access user_data vehicle_device_data vehicle_location';

const MI = 1.609344; // Tesla reports odometer and range in miles.

const oauth = {
  tokenUrl: TOKEN_URL,
  basicAuth: false,
  authorizeUrl(cfg, { redirectUri, state, challenge }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope: cfg.scopes || DEFAULT_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt_missing_scopes: 'true',
    });
    return `${AUTH}/authorize?${params}`;
  },
};

const base = (cfg) => (cfg.endpoint || DEFAULT_API).replace(/\/$/, '');

// Firestore rejects `undefined`; drop empty values recursively.
const clean = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v]),
  );

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const km = (miles) => (num(miles) == null ? undefined : Math.round(num(miles) * MI));
const iso = (ms) => (num(ms) == null ? undefined : new Date(num(ms)).toISOString());

// Tesla charging_state -> the values VehicleView understands (IDLE / DONE are inactive).
const CHARGING = {
  Charging: 'CHARGING',
  Starting: 'CHARGING',
  Complete: 'DONE',
  Disconnected: 'IDLE',
  Stopped: 'IDLE',
  NoPower: 'IDLE',
};

const DOORS = { frontLeftDoor: 'df', frontRightDoor: 'pf', rearLeftDoor: 'dr', rearRightDoor: 'pr', hood: 'ft', tailgate: 'rt' };
const WINDOWS = { frontLeftWindow: 'fd_window', frontRightWindow: 'fp_window', rearLeftWindow: 'rd_window', rearRightWindow: 'rp_window' };

/** { frontLeftDoor: 'df' } + vehicle_state -> { frontLeftDoor: 'OPEN' | 'CLOSED' }, skipping unknown keys. */
function openClosed(vs, map) {
  const out = {};
  for (const [name, key] of Object.entries(map)) {
    if (vs?.[key] != null) out[name] = Number(vs[key]) !== 0 ? 'OPEN' : 'CLOSED';
  }
  return Object.keys(out).length ? out : undefined;
}

/** Maps a Fleet API vehicle_data response (the `response` object) onto the Car tab state keys. */
export function vehicleState(data) {
  const cs = data?.charge_state;
  const ds = data?.drive_state;
  const vs = data?.vehicle_state;
  const vc = data?.vehicle_config;
  const state = {};

  if (cs) {
    state.batteryPercent = num(cs.battery_level);
    state.rangeKm = km(cs.battery_range);
    state.charging = CHARGING[cs.charging_state] ?? (cs.charging_state ? String(cs.charging_state).toUpperCase() : undefined);
    state.charge = {
      connection: cs.conn_charge_cable || cs.charge_port_latch,
      powerW: num(cs.charger_power) == null ? undefined : num(cs.charger_power) * 1000,
      currentLimitA: num(cs.charge_current_request),
      targetPercent: num(cs.charge_limit_soc),
      minutesToTarget: num(cs.minutes_to_full_charge),
    };
  }

  if (vs) {
    state.odometerKm = km(vs.odometer);
    if (typeof vs.locked === 'boolean') state.locked = vs.locked;
    state.doors = openClosed(vs, DOORS);
    if (state.doors) state.doorsOpen = Object.entries(state.doors).filter(([, v]) => v === 'OPEN').map(([k]) => k);
    state.windows = openClosed(vs, WINDOWS);
    if (state.windows) state.windowsOpen = Object.entries(state.windows).filter(([, v]) => v === 'OPEN').map(([k]) => k);
    state.warnings = Object.entries(vs)
      .filter(([k, v]) => /^tpms_(soft|hard)_warning_/.test(k) && v === true)
      .map(([name]) => ({ name, value: 'WARNING' }));
  }

  if (ds && num(ds.latitude) != null && num(ds.longitude) != null) {
    state.location = { lat: num(ds.latitude), lon: num(ds.longitude), heading: num(ds.heading), at: iso(ds.timestamp) };
  }

  const stamps = [cs?.timestamp, vs?.timestamp].map(num).filter((t) => t != null);
  if (stamps.length) state.reportedAt = iso(Math.max(...stamps));

  if (vc?.car_type) state.details = { model: vc.car_type };

  return clean(state);
}

function device(vin, name, online, state) {
  return {
    providerId: vin,
    name: name || `Tesla ${vin.slice(-6)}`,
    type: 'vehicle',
    online,
    state: clean(state),
    capabilities: [], // read-only
    meta: { vin },
    suggestedRoom: 'Garage',
  };
}

const VEHICLE_DATA = 'endpoints=' + encodeURIComponent('charge_state;drive_state;vehicle_state;vehicle_config;location_data');

async function vehicle(cfg, h, vin, known) {
  let info = known;
  if (!info) {
    try {
      info = (await fetchJson(`${base(cfg)}/api/1/vehicles/${vin}`, { headers: h }))?.response;
    } catch (e) {
      logger.info(`tesla ${vin} info unavailable: ${e.message}`);
    }
  }
  const name = info?.display_name;
  if (info?.state && info.state !== 'online') return device(vin, name, false, {});
  try {
    const r = await fetchJson(`${base(cfg)}/api/1/vehicles/${vin}/vehicle_data?${VEHICLE_DATA}`, { headers: h });
    return device(vin, name, true, vehicleState(r?.response));
  } catch (e) {
    // 408: the car is asleep or offline. Report it as offline instead of waking it.
    if (e.status === 408) return device(vin, name, false, {});
    throw e;
  }
}

export default {
  id: 'tesla',
  oauth,
  requiredConfig: ['clientId', 'clientSecret'],
  configFields: ['clientId', 'clientSecret', 'endpoint', 'vins', 'scopes', 'redirectUri'],

  async listDevices(cfg, ctx) {
    const token = await ensureAccessToken(oauth, cfg, ctx);
    const h = { Authorization: `Bearer ${token}` };
    const configured = (cfg.vins ?? '').split(/[\s,]+/).map((v) => v.trim().toUpperCase()).filter(Boolean);
    let cars;
    if (configured.length) {
      cars = configured.map((vin) => ({ vin }));
    } else {
      const list = await fetchJson(`${base(cfg)}/api/1/vehicles`, { headers: h });
      cars = (list?.response ?? []).filter((v) => v?.vin).map((v) => ({ vin: v.vin, info: v }));
    }
    return Promise.all(cars.map(({ vin, info }) => vehicle(cfg, h, vin, info)));
  },

  async command() {
    throw new ProviderError('The Tesla integration is read-only.', 400);
  },
};
