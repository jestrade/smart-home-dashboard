// Home Assistant REST API: a bridge for everything else (Zigbee, Z-Wave, Matter, Hue, Sonos…).
// The instance must be reachable from the internet (e.g. Nabu Casa remote URL).
// Docs: https://developers.home-assistant.io/docs/api/rest/
import { fetchJson, ProviderError } from '../lib/http.js';

const DOMAIN_TYPES = {
  light: 'light',
  switch: 'switch',
  input_boolean: 'switch',
  fan: 'fan',
  climate: 'thermostat',
  lock: 'lock',
  cover: 'cover',
  sensor: 'sensor',
  binary_sensor: 'sensor',
};
const SENSOR_CLASSES = new Set(['temperature', 'humidity', 'door', 'window', 'motion', 'opening']);

const baseUrl = (cfg) => cfg.baseUrl.replace(/\/$/, '');
const authHeaders = (cfg) => ({ Authorization: `Bearer ${cfg.token}` });

function normalize(e) {
  const [domain] = e.entity_id.split('.');
  const a = e.attributes ?? {};
  const state = {};
  const capabilities = [];

  switch (domain) {
    case 'light':
      state.on = e.state === 'on';
      capabilities.push('onoff');
      if ((a.supported_color_modes ?? []).some((m) => m !== 'onoff')) {
        capabilities.push('brightness');
        state.brightness = a.brightness != null ? Math.round((a.brightness / 255) * 100) : 0;
      }
      break;
    case 'switch':
    case 'input_boolean':
    case 'fan':
      state.on = e.state === 'on';
      capabilities.push('onoff');
      break;
    case 'climate':
      state.temperature = a.current_temperature ?? null;
      state.targetTemperature = a.temperature ?? null;
      state.mode = e.state;
      state.availableModes = a.hvac_modes ?? [];
      capabilities.push('thermostat', 'mode');
      break;
    case 'lock':
      state.locked = e.state === 'locked';
      capabilities.push('lock');
      break;
    case 'cover':
      state.open = e.state === 'open';
      if (a.current_position != null) state.position = a.current_position;
      capabilities.push('cover');
      break;
    case 'sensor':
      if (a.device_class === 'temperature') state.temperature = Number(e.state);
      if (a.device_class === 'humidity') state.humidity = Number(e.state);
      break;
    case 'binary_sensor':
      state.open = e.state === 'on';
      break;
  }

  return {
    providerId: e.entity_id,
    name: a.friendly_name ?? e.entity_id,
    type: DOMAIN_TYPES[domain] ?? 'other',
    model: domain,
    online: e.state !== 'unavailable',
    state,
    capabilities,
    meta: { domain },
    suggestedRoom: null,
  };
}

function wanted(e, include) {
  const [domain] = e.entity_id.split('.');
  if (include.length) return include.some((p) => e.entity_id.startsWith(p));
  if (!(domain in DOMAIN_TYPES)) return false;
  if (domain === 'sensor' || domain === 'binary_sensor') return SENSOR_CLASSES.has(e.attributes?.device_class);
  return true;
}

export default {
  id: 'homeassistant',
  requiredConfig: ['baseUrl', 'token'],
  configFields: ['baseUrl', 'token', 'include'],

  async listDevices(cfg) {
    const include = (cfg.include ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const states = await fetchJson(`${baseUrl(cfg)}/api/states`, { headers: authHeaders(cfg) });
    return states.filter((e) => wanted(e, include)).map(normalize);
  },

  async command(cfg, device, action, value) {
    const entity_id = device.providerId;
    const domain = device.meta?.domain ?? entity_id.split('.')[0];
    const coverServices = { open: 'open_cover', close: 'close_cover', stop: 'stop_cover' };
    const calls = {
      setOn: () => [domain, value ? 'turn_on' : 'turn_off', {}, { on: Boolean(value) }],
      setBrightness: () => ['light', 'turn_on', { brightness_pct: value }, { brightness: value, on: value > 0 }],
      setTemperature: () => ['climate', 'set_temperature', { temperature: value }, { targetTemperature: value }],
      setMode: () => ['climate', 'set_hvac_mode', { hvac_mode: value }, { mode: value }],
      lock: () => ['lock', 'lock', {}, { locked: true }],
      unlock: () => ['lock', 'unlock', {}, { locked: false }],
      cover: () => ['cover', coverServices[value], {}, {}],
    };
    if (!calls[action]) throw new ProviderError(`Home Assistant: "${action}" is not supported.`, 400);
    const [svcDomain, service, data, patch] = calls[action]();
    if (!service) throw new ProviderError(`Unknown cover command "${value}".`, 400);
    await fetchJson(`${baseUrl(cfg)}/api/services/${svcDomain}/${service}`, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: { entity_id, ...data },
    });
    return patch;
  },
};
