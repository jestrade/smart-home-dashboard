// Volvo Cars Connected Vehicle API v2, Energy API v2 and Location API — read-only.
// Docs: https://developer.volvocars.com/apis/
import { logger } from 'firebase-functions';
import { fetchJson, ProviderError } from '../lib/http.js';
import { ensureAccessToken } from '../lib/oauth.js';

const API = 'https://api.volvocars.com';
// Volvo ID (Keycloak). Endpoints from https://auth.volvocars.com/realms/volvocars/.well-known/openid-configuration
const AUTH = 'https://auth.volvocars.com/realms/volvocars/protocol/openid-connect';

// Read-only scopes. Add conve:vehicle_relation (vehicle list, model, photo) or
// conve:diagnostics_workshop (service intervals) if your Volvo app has them.
const DEFAULT_SCOPES = [
  'openid',
  'conve:lock_status',
  'conve:doors_status',
  'conve:windows_status',
  'conve:odometer_status',
  'conve:fuel_status',
  'conve:engine_status',
  'conve:battery_charge_level',
  'conve:tyre_status',
  'conve:warnings',
  'conve:brake_status',
  'conve:diagnostics_engine_status',
  'conve:trip_statistics',
  'energy:state:read',
  'location:read',
].join(' ');

const oauth = {
  tokenUrl: `${AUTH}/token`,
  basicAuth: true,
  authorizeUrl(cfg, { redirectUri, state, challenge }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope: cfg.scopes || DEFAULT_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `${AUTH}/auth?${params}`;
  },
};

async function headers(cfg, ctx) {
  const token = await ensureAccessToken(oauth, cfg, ctx);
  return { Authorization: `Bearer ${token}`, 'vcc-api-key': cfg.apiKey };
}

// Every Volvo reading looks like { value, unit?, timestamp }.
const val = (o, k) => o?.[k]?.value;
const isOk = (v) => v == null || ['NO_WARNING', 'UNSPECIFIED', 'NO_FAILURE', 'NORMAL', 'OK'].includes(v);

/** { frontLeftDoor: {value:'CLOSED'} } -> { frontLeftDoor: 'CLOSED' } */
function flatten(obj, skip = []) {
  if (!obj) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!skip.includes(k) && v && typeof v === 'object' && 'value' in v) out[k] = v.value;
  }
  return out;
}

function latestTimestamp(objs) {
  let latest = null;
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    for (const v of Object.values(o)) {
      const t = v?.timestamp ?? v?.updatedAt;
      if (t && (!latest || t > latest)) latest = t;
    }
  }
  return latest;
}

const CV = `${API}/connected-vehicle/v2/vehicles`;
const ENDPOINTS = {
  details: (vin) => `${CV}/${vin}`,
  doors: (vin) => `${CV}/${vin}/doors`,
  windows: (vin) => `${CV}/${vin}/windows`,
  odometer: (vin) => `${CV}/${vin}/odometer`,
  fuel: (vin) => `${CV}/${vin}/fuel`,
  engineStatus: (vin) => `${CV}/${vin}/engine-status`,
  engine: (vin) => `${CV}/${vin}/engine`,
  diagnostics: (vin) => `${CV}/${vin}/diagnostics`,
  brakes: (vin) => `${CV}/${vin}/brakes`,
  tyres: (vin) => `${CV}/${vin}/tyres`,
  warnings: (vin) => `${CV}/${vin}/warnings`,
  statistics: (vin) => `${CV}/${vin}/statistics`,
  energy: (vin) => `${API}/energy/v2/vehicles/${vin}/state`,
  location: (vin) => `${API}/location/v1/vehicles/${vin}/location`,
};

// Firestore rejects `undefined`; drop empty values recursively.
const clean = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v]),
  );

async function vehicleState(vin, h) {
  const names = Object.keys(ENDPOINTS);
  const results = await Promise.allSettled(names.map((n) => fetchJson(ENDPOINTS[n](vin), { headers: h })));
  const r = {};
  const unavailable = [];
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') r[names[i]] = res.value?.data ?? res.value;
    else {
      unavailable.push(names[i]);
      logger.info(`volvo ${names[i]} unavailable: ${res.reason?.message}`);
    }
  });
  if (unavailable.length === names.length) throw results[1].reason;

  const { details, doors, windows, odometer, fuel, engineStatus, engine, diagnostics, brakes, tyres, warnings, statistics, energy, location } = r;
  const state = { unavailable };

  // Locks, doors, windows
  if (doors) {
    state.locked = val(doors, 'centralLock') === 'LOCKED';
    state.doors = flatten(doors, ['centralLock']);
    state.doorsOpen = Object.entries(state.doors).filter(([, v]) => v === 'OPEN').map(([k]) => k);
  }
  if (windows) {
    state.windows = flatten(windows);
    state.windowsOpen = Object.entries(state.windows).filter(([, v]) => v === 'OPEN' || v === 'AJAR').map(([k]) => k);
  }

  // Distance, fuel, engine
  if (odometer) state.odometerKm = val(odometer, 'odometer');
  if (fuel) state.fuelLiters = val(fuel, 'fuelAmount');
  if (engineStatus) state.engineRunning = val(engineStatus, 'engineStatus') === 'RUNNING';

  // Battery and charging
  if (energy) {
    state.batteryPercent = val(energy, 'batteryChargeLevel');
    state.rangeKm = val(energy, 'electricRange');
    state.charging = val(energy, 'chargingStatus');
    state.charge = {
      connection: val(energy, 'chargerConnectionStatus'),
      type: val(energy, 'chargingType'),
      powerStatus: val(energy, 'chargerPowerStatus'),
      powerW: val(energy, 'chargingPower'),
      currentLimitA: val(energy, 'chargingCurrentLimit'),
      targetPercent: val(energy, 'targetBatteryChargeLevel'),
      minutesToTarget: val(energy, 'estimatedChargingTimeToTargetBatteryChargeLevel'),
    };
  }

  // Trip statistics
  if (statistics) {
    state.trip = {
      avgEnergyKwhPer100km: val(statistics, 'averageEnergyConsumption'),
      avgFuelLPer100km: val(statistics, 'averageFuelConsumption'),
      avgSpeedKmh: val(statistics, 'averageSpeed'),
      tripManualKm: val(statistics, 'tripMeterManual'),
      tripAutomaticKm: val(statistics, 'tripMeterAutomatic'),
      distanceToEmptyBatteryKm: val(statistics, 'distanceToEmptyBattery'),
      distanceToEmptyTankKm: val(statistics, 'distanceToEmptyTank'),
    };
  }

  // Health: fluids, tyres, service, lamps
  state.health = {
    oil: val(engine, 'oilLevelWarning'),
    coolant: val(engine, 'engineCoolantLevelWarning'),
    brakeFluid: val(brakes, 'brakeFluidLevelWarning'),
    washerFluid: val(diagnostics, 'washerFluidLevelWarning'),
    service: val(diagnostics, 'serviceWarning'),
  };
  if (diagnostics) {
    state.service = {
      distanceKm: val(diagnostics, 'distanceToService'),
      months: val(diagnostics, 'timeToService'),
      engineHours: val(diagnostics, 'engineHoursToService'),
    };
  }
  if (tyres) state.tyres = flatten(tyres);
  const tyreWarnings = Object.fromEntries(Object.entries(state.tyres ?? {}).map(([k, v]) => [`${k}Tyre`, v]));
  const warningValues = { ...flatten(warnings), ...tyreWarnings };
  state.warnings = Object.entries(warningValues)
    .filter(([, v]) => !isOk(v))
    .map(([name, value]) => ({ name, value }));
  for (const [name, value] of Object.entries(state.health)) {
    if (!isOk(value)) state.warnings.push({ name, value });
  }
  state.lampChecks = warnings ? Object.keys(flatten(warnings)).length : 0;

  // Location
  const coords = location?.geometry?.coordinates;
  if (coords?.length >= 2) {
    state.location = {
      lon: coords[0],
      lat: coords[1],
      heading: location.properties?.heading ?? null,
      at: location.properties?.timestamp ?? null,
    };
  }

  // Vehicle details (needs conve:vehicle_relation)
  if (details?.images?.exteriorImageUrl) state.imageUrl = details.images.exteriorImageUrl;
  if (details) {
    state.details = {
      model: details.descriptions?.model,
      modelYear: details.modelYear,
      fuelType: details.fuelType,
      color: details.externalColour,
      gearbox: details.gearbox,
      batteryCapacityKwh: details.batteryCapacityKWH,
    };
  }

  state.reportedAt = latestTimestamp([doors, windows, odometer, fuel, engineStatus, engine, brakes, tyres, warnings, statistics, energy]);

  return {
    providerId: vin,
    name: [details?.descriptions?.model, details?.modelYear].filter(Boolean).join(' ') || `Volvo ${vin.slice(-6)}`,
    type: 'vehicle',
    model: details?.descriptions?.model ?? null,
    online: true,
    state: clean(state),
    capabilities: [], // read-only
    meta: { vin },
    suggestedRoom: 'Garage',
  };
}

export default {
  id: 'volvo',
  oauth,
  requiredConfig: ['clientId', 'clientSecret', 'apiKey'],
  configFields: ['clientId', 'clientSecret', 'apiKey', 'vins', 'scopes', 'redirectUri'],

  async listDevices(cfg, ctx) {
    const h = await headers(cfg, ctx);
    // Listing vehicles needs the conve:vehicle_relation scope; a configured VIN skips that call.
    let vins = (cfg.vins ?? '').split(/[\s,]+/).map((v) => v.trim().toUpperCase()).filter(Boolean);
    if (vins.length === 0) {
      try {
        const list = await fetchJson(`${CV}`, { headers: h });
        vins = (list?.data ?? []).map((v) => v.vin);
      } catch (e) {
        if (e.status === 403) {
          throw new ProviderError(
            'Volvo refused to list your vehicles (the app lacks the conve:vehicle_relation permission). Enter your VIN in the Volvo card and save.',
            403,
          );
        }
        throw e;
      }
    }
    return Promise.all(vins.map((vin) => vehicleState(vin, h)));
  },

  async command() {
    throw new ProviderError('The Volvo integration is read-only.', 400);
  },
};
