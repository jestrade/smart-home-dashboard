// Google Nest via the Smart Device Management (SDM) API: thermostats, cameras, doorbells, displays.
// Docs: https://developers.google.com/nest/device-access/api
// Note: Google does not expose generic "Google Home" devices (third-party lights, plugs…) to
// cloud APIs; connect those through their own provider (Tuya, Home Assistant…).
import { fetchJson, ProviderError } from '../lib/http.js';
import { ensureAccessToken } from '../lib/oauth.js';

const API = 'https://smartdevicemanagement.googleapis.com/v1';

const TYPES = {
  'sdm.devices.types.THERMOSTAT': 'thermostat',
  'sdm.devices.types.CAMERA': 'camera',
  'sdm.devices.types.DOORBELL': 'camera',
  'sdm.devices.types.DISPLAY': 'camera',
};

const oauth = {
  tokenUrl: 'https://oauth2.googleapis.com/token',
  basicAuth: false,
  authorizeUrl(cfg, { redirectUri, state, challenge }) {
    const params = new URLSearchParams({
      redirect_uri: redirectUri,
      access_type: 'offline',
      prompt: 'consent',
      client_id: cfg.clientId,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/sdm.service',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `https://nestservices.google.com/partnerconnections/${cfg.projectId}/auth?${params}`;
  },
};

function normalize(d) {
  const trait = (k) => d.traits?.[`sdm.devices.traits.${k}`];
  const room = d.parentRelations?.[0]?.displayName ?? null;
  const type = TYPES[d.type] ?? 'other';
  const state = {};
  const capabilities = [];

  const temp = trait('Temperature')?.ambientTemperatureCelsius;
  if (temp != null) state.temperature = Math.round(temp * 10) / 10;
  const hum = trait('Humidity')?.ambientHumidityPercent;
  if (hum != null) state.humidity = hum;

  const mode = trait('ThermostatMode');
  if (mode) {
    state.mode = mode.mode;
    state.availableModes = mode.availableModes;
    capabilities.push('mode');
  }
  const setpoint = trait('ThermostatTemperatureSetpoint');
  if (setpoint) {
    state.heatSetpoint = setpoint.heatCelsius ?? null;
    state.coolSetpoint = setpoint.coolCelsius ?? null;
    state.targetTemperature = state.mode === 'COOL' ? setpoint.coolCelsius : setpoint.heatCelsius ?? setpoint.coolCelsius;
    capabilities.push('thermostat');
  }
  const hvac = trait('ThermostatHvac')?.status;
  if (hvac) state.hvac = hvac;

  const label = { thermostat: 'Thermostat', camera: 'Camera' }[type] ?? 'Device';
  return {
    providerId: d.name.split('/').pop(),
    name: trait('Info')?.customName || (room ? `${room} ${label}` : `Nest ${label}`),
    type,
    model: d.type.replace('sdm.devices.types.', ''),
    online: trait('Connectivity')?.status !== 'OFFLINE',
    state,
    capabilities,
    meta: { resource: d.name },
    suggestedRoom: room,
  };
}

export default {
  id: 'google',
  oauth,
  requiredConfig: ['clientId', 'clientSecret', 'projectId'],
  configFields: ['clientId', 'clientSecret', 'projectId', 'redirectUri'],

  async listDevices(cfg, ctx) {
    const token = await ensureAccessToken(oauth, cfg, ctx);
    const r = await fetchJson(`${API}/enterprises/${cfg.projectId}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (r?.devices ?? []).map(normalize);
  },

  async command(cfg, device, action, value, ctx) {
    const token = await ensureAccessToken(oauth, cfg, ctx);
    const exec = (command, params) =>
      fetchJson(`${API}/${device.meta.resource}:executeCommand`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { command, params },
      });
    const base = 'sdm.devices.commands.';

    if (action === 'setMode') {
      await exec(`${base}ThermostatMode.SetMode`, { mode: value });
      return { mode: value };
    }
    if (action === 'setTemperature') {
      const mode = device.state?.mode;
      if (mode === 'HEAT') await exec(`${base}ThermostatTemperatureSetpoint.SetHeat`, { heatCelsius: value });
      else if (mode === 'COOL') await exec(`${base}ThermostatTemperatureSetpoint.SetCool`, { coolCelsius: value });
      else if (mode === 'HEATCOOL') {
        await exec(`${base}ThermostatTemperatureSetpoint.SetRange`, { heatCelsius: value - 1.5, coolCelsius: value + 1.5 });
      } else throw new ProviderError('Pick Heat, Cool or Heat·Cool mode before setting a temperature.', 400);
      return { targetTemperature: value };
    }
    throw new ProviderError(`Nest devices do not support "${action}".`, 400);
  },
};
