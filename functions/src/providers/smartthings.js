// Samsung SmartThings via the REST API. Two ways to authorise it:
// - a Personal Access Token from account.smartthings.com/tokens: quick, but it lasts only 24 hours;
// - a webhook SmartApp ("Automation" registered in the Developer Workspace and installed from the
//   SmartThings app), whose INSTALL lifecycle (functions/src/lib/smartapp.js) stores refreshable tokens.
// The SmartApp is used when it is installed; otherwise the personal token.
// Docs: https://developer.smartthings.com/docs/api/public
import { fetchJson, ProviderError } from '../lib/http.js';

const API = 'https://api.smartthings.com/v1';
const TOKEN_URL = 'https://auth-global.api.smartthings.com/oauth/token';

/** SmartApp access tokens last 5 minutes; refresh tokens 30 days and rotate on every use. */
async function accessToken(cfg, ctx) {
  if (!cfg.refreshToken && cfg.token) return cfg.token;
  if (cfg.accessToken && cfg.expiresAt > Date.now() + 30_000) return cfg.accessToken;
  if (!cfg.refreshToken) throw new ProviderError('Not connected yet. Save a personal access token, or add the Home Dashboard automation in the SmartThings app.', 401);
  if (!cfg.clientId || !cfg.clientSecret) throw new ProviderError('Save the SmartApp client ID and secret on the SmartThings card.', 401);
  let tok;
  try {
    tok = await fetchJson(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64') },
      form: { grant_type: 'refresh_token', client_id: cfg.clientId, refresh_token: cfg.refreshToken },
    });
  } catch (e) {
    throw new ProviderError(`SmartThings token refresh failed; reinstall the Home Dashboard automation in the SmartThings app. ${e.message}`, 401);
  }
  const patch = {
    accessToken: tok.access_token,
    expiresAt: Date.now() + (Number(tok.expires_in) || 300) * 1000,
    ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
  };
  await ctx.saveConfig(patch);
  Object.assign(cfg, patch);
  return cfg.accessToken;
}

const fToC = (f) => Math.round(((f - 32) * 5) / 9 * 10) / 10;
const cToF = (c) => Math.round((c * 9) / 5 + 32);

function typeFor(caps) {
  if (caps.has('lock')) return 'lock';
  if (caps.has('windowShade') || caps.has('doorControl')) return 'cover';
  if (caps.has('thermostatMode') || caps.has('airConditionerMode')) return 'thermostat';
  if (caps.has('videoCamera') || caps.has('videoStream')) return 'camera';
  if (caps.has('fanSpeed') && caps.has('switch')) return 'fan';
  if (caps.has('colorControl') || caps.has('colorTemperature') || caps.has('switchLevel')) return 'light';
  if (caps.has('powerMeter') && caps.has('switch')) return 'plug';
  if (caps.has('switch')) return 'switch';
  if (['temperatureMeasurement', 'contactSensor', 'motionSensor', 'relativeHumidityMeasurement', 'waterSensor'].some((c) => caps.has(c))) return 'sensor';
  return 'other';
}

function normalize(d, status, rooms) {
  const main = status?.components?.main ?? {};
  const v = (cap, attr) => main?.[cap]?.[attr]?.value;
  const unit = (cap, attr) => main?.[cap]?.[attr]?.unit;
  const caps = new Set((d.components ?? []).find((c) => c.id === 'main')?.capabilities?.map((c) => c.id) ?? []);
  const state = {};
  const capabilities = [];
  const tempUnit = unit('temperatureMeasurement', 'temperature') ?? unit('thermostatCoolingSetpoint', 'coolingSetpoint') ?? 'C';
  const toC = (x) => (x == null ? undefined : tempUnit === 'F' ? fToC(x) : x);

  if (caps.has('switch')) {
    state.on = v('switch', 'switch') === 'on';
    capabilities.push('onoff');
  }
  if (caps.has('switchLevel')) {
    state.brightness = v('switchLevel', 'level') ?? 0;
    capabilities.push('brightness');
  }
  if (caps.has('temperatureMeasurement')) state.temperature = toC(v('temperatureMeasurement', 'temperature'));
  if (caps.has('relativeHumidityMeasurement')) state.humidity = v('relativeHumidityMeasurement', 'humidity');
  if (caps.has('battery')) state.battery = v('battery', 'battery');
  if (caps.has('contactSensor')) state.open = v('contactSensor', 'contact') === 'open';
  if (caps.has('motionSensor')) state.motion = v('motionSensor', 'motion') === 'active';
  if (caps.has('powerMeter')) state.powerW = v('powerMeter', 'power');

  // Thermostats and air conditioners
  let setpointCap = null;
  if (caps.has('thermostatMode')) {
    state.mode = v('thermostatMode', 'thermostatMode');
    state.availableModes = v('thermostatMode', 'supportedThermostatModes') ?? undefined;
    capabilities.push('mode');
  } else if (caps.has('airConditionerMode')) {
    state.mode = v('airConditionerMode', 'airConditionerMode');
    state.availableModes = v('airConditionerMode', 'supportedAcModes') ?? undefined;
    capabilities.push('mode');
  }
  if (caps.has('thermostatCoolingSetpoint') && (state.mode === 'cool' || !caps.has('thermostatHeatingSetpoint'))) {
    setpointCap = 'thermostatCoolingSetpoint';
    state.targetTemperature = toC(v('thermostatCoolingSetpoint', 'coolingSetpoint'));
  } else if (caps.has('thermostatHeatingSetpoint')) {
    setpointCap = 'thermostatHeatingSetpoint';
    state.targetTemperature = toC(v('thermostatHeatingSetpoint', 'heatingSetpoint'));
  }
  if (setpointCap) capabilities.push('thermostat');
  if (caps.has('thermostatOperatingState')) state.hvac = v('thermostatOperatingState', 'thermostatOperatingState');

  if (caps.has('lock')) {
    state.locked = v('lock', 'lock') === 'locked';
    capabilities.push('lock');
  }
  if (caps.has('windowShade')) {
    const shade = v('windowShade', 'windowShade');
    state.open = shade === 'open' || shade === 'partially open';
    if (caps.has('windowShadeLevel')) state.position = v('windowShadeLevel', 'shadeLevel');
    capabilities.push('cover');
  }

  const online = d.healthState?.state ? d.healthState.state === 'ONLINE' : true;
  return {
    providerId: d.deviceId,
    name: d.label || d.name || 'SmartThings device',
    type: typeFor(caps),
    model: d.ocf?.modelNumber ?? d.deviceTypeName ?? d.name ?? null,
    online,
    state: Object.fromEntries(Object.entries(state).filter(([, x]) => x !== undefined && x !== null)),
    capabilities,
    meta: { tempUnit, setpointCap, ac: caps.has('airConditionerMode') },
    suggestedRoom: rooms.get(d.roomId) ?? null,
  };
}

async function api(cfg, ctx, path, opts = {}) {
  const token = await accessToken(cfg, ctx);
  try {
    return await fetchJson(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    if ((e.status === 401 || e.status === 403) && token === cfg.token) {
      throw new ProviderError('SmartThings rejected the personal access token. Tokens last 24 hours: create a new one at account.smartthings.com/tokens and save it here.', 401);
    }
    throw e;
  }
}

async function listAll(cfg, ctx, path) {
  const items = [];
  let next = path;
  while (next) {
    const r = await api(cfg, ctx, next);
    items.push(...(r.items ?? []));
    const href = r._links?.next?.href;
    next = href ? href.replace(API, '') : null;
  }
  return items;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export default {
  id: 'smartthings',
  requiredConfig: [],
  configFields: ['token', 'clientId', 'clientSecret'],
  isConfigured: (cfg) => Boolean(cfg.token || (cfg.clientId && cfg.clientSecret)),
  // Connected with a personal token, or once the SmartApp has been installed (tokens arrive via the webhook).
  isConnected: (cfg) => Boolean(cfg.token || cfg.refreshToken),

  async listDevices(cfg, ctx) {
    const [devices, locations] = await Promise.all([listAll(cfg, ctx, '/devices'), listAll(cfg, ctx, '/locations')]);
    const rooms = new Map();
    await Promise.all(
      locations.map(async (loc) => {
        for (const room of await listAll(cfg, ctx, `/locations/${loc.locationId}/rooms`).catch(() => [])) {
          rooms.set(room.roomId, room.name);
        }
      }),
    );
    return mapLimit(devices, 8, async (d) => {
      const status = await api(cfg, ctx, `/devices/${d.deviceId}/status`).catch(() => null);
      return normalize(d, status, rooms);
    });
  },

  async command(cfg, device, action, value, ctx) {
    const m = device.meta ?? {};
    const toUnit = (c) => (m.tempUnit === 'F' ? cToF(c) : c);
    const cmd = (capability, command, args = []) => ({ component: 'main', capability, command, arguments: args });
    let commands;
    let patch;
    switch (action) {
      case 'setOn':
        commands = [cmd('switch', value ? 'on' : 'off')];
        patch = { on: Boolean(value) };
        break;
      case 'setBrightness':
        commands = [cmd('switchLevel', 'setLevel', [value])];
        patch = { brightness: value, on: value > 0 };
        break;
      case 'setTemperature':
        if (!m.setpointCap) throw new ProviderError('This device has no adjustable temperature.', 400);
        commands = [
          m.setpointCap === 'thermostatCoolingSetpoint'
            ? cmd('thermostatCoolingSetpoint', 'setCoolingSetpoint', [toUnit(value)])
            : cmd('thermostatHeatingSetpoint', 'setHeatingSetpoint', [toUnit(value)]),
        ];
        patch = { targetTemperature: value };
        break;
      case 'setMode':
        commands = [m.ac ? cmd('airConditionerMode', 'setAirConditionerMode', [value]) : cmd('thermostatMode', 'setThermostatMode', [value])];
        patch = { mode: value };
        break;
      case 'lock':
      case 'unlock':
        commands = [cmd('lock', action)];
        patch = { locked: action === 'lock' };
        break;
      case 'cover':
        commands = [cmd('windowShade', { open: 'open', close: 'close', stop: 'pause' }[value])];
        patch = {};
        break;
      default:
        throw new ProviderError(`SmartThings: "${action}" is not supported.`, 400);
    }
    await api(cfg, ctx, `/devices/${device.providerId}/commands`, { method: 'POST', body: { commands } });
    return patch;
  },
};
