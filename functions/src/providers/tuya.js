// Tuya Cloud OpenAPI (devices paired in the Tuya / Smart Life app).
// Docs: https://developer.tuya.com/en/docs/iot/new-singnature
import crypto from 'node:crypto';
import { fetchJson, ProviderError } from '../lib/http.js';

const CATEGORY_TYPES = {
  dj: 'light', dd: 'light', xdd: 'light', fwd: 'light', dc: 'light', fsd: 'light', tgq: 'light',
  kg: 'switch', tdq: 'switch', cz: 'plug', pc: 'plug',
  wk: 'thermostat', kt: 'thermostat', wkf: 'thermostat',
  cl: 'cover', clkg: 'cover', ms: 'lock', jtmspro: 'lock', sp: 'camera', fs: 'fan',
  wsdcg: 'sensor', mcs: 'sensor', pir: 'sensor', ywbj: 'sensor', rqbj: 'sensor', sj: 'sensor',
};

const tokenCache = new Map(); // clientId -> { token, expiresAt }

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('hex').toUpperCase();

function signedPath(path, query) {
  const qs = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}

async function rawRequest(cfg, method, path, { query, body, token } = {}) {
  const url = signedPath(path, query);
  const bodyStr = body ? JSON.stringify(body) : '';
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const stringToSign = [method, sha256(bodyStr), '', url].join('\n');
  const sign = hmac(cfg.clientSecret, cfg.clientId + (token ?? '') + t + nonce + stringToSign);
  const headers = {
    client_id: cfg.clientId,
    sign,
    t,
    nonce,
    sign_method: 'HMAC-SHA256',
    ...(token ? { access_token: token } : {}),
  };
  const endpoint = (cfg.endpoint || 'https://openapi.tuyaus.com').replace(/\/$/, '');
  const data = await fetchJson(endpoint + url, { method, headers, body: body ? bodyStr : undefined });
  if (!data?.success) {
    const authError = [1004, 1010, 1011, 1106].includes(data?.code);
    throw new ProviderError(`Tuya ${path}: ${data?.msg ?? 'unknown error'} (code ${data?.code})`, authError ? 401 : 400);
  }
  return data.result;
}

async function getToken(cfg) {
  const cached = tokenCache.get(cfg.clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const r = await rawRequest(cfg, 'GET', '/v1.0/token', { query: { grant_type: 1 } });
  tokenCache.set(cfg.clientId, { token: r.access_token, expiresAt: Date.now() + r.expire_time * 1000 });
  return r.access_token;
}

async function call(cfg, method, path, opts = {}) {
  try {
    return await rawRequest(cfg, method, path, { ...opts, token: await getToken(cfg) });
  } catch (e) {
    if (e.status !== 401) throw e;
    tokenCache.delete(cfg.clientId); // token expired/revoked: retry once with a fresh one
    return rawRequest(cfg, method, path, { ...opts, token: await getToken(cfg) });
  }
}

// Tuya reports many temperatures ×10 (e.g. 215 = 21.5 °C). Without fetching each
// product's spec we infer the scale from the magnitude.
const tempScale = (v) => (typeof v === 'number' && Math.abs(v) > 60 ? 10 : 1);

function normalize(d) {
  const s = Object.fromEntries((d.status ?? []).map((x) => [x.code, x.value]));
  const state = {};
  const capabilities = [];
  const meta = { category: d.category };

  const switchCode = ['switch_led', 'switch', 'switch_1'].find((c) => c in s);
  if (switchCode) {
    meta.switchCode = switchCode;
    state.on = Boolean(s[switchCode]);
    capabilities.push('onoff');
  }

  const brightCode = ['bright_value_v2', 'bright_value'].find((c) => c in s);
  if (brightCode) {
    const [min, max] = brightCode === 'bright_value_v2' ? [10, 1000] : [25, 255];
    Object.assign(meta, { brightCode, brightMin: min, brightMax: max });
    state.brightness = Math.max(0, Math.min(100, Math.round(((s[brightCode] - min) / (max - min)) * 100)));
    capabilities.push('brightness');
  }

  const tempCode = ['va_temperature', 'temp_current'].find((c) => c in s);
  if (tempCode) state.temperature = s[tempCode] / tempScale(s[tempCode]);
  const humCode = ['va_humidity', 'humidity_value'].find((c) => c in s);
  if (humCode) state.humidity = s[humCode] > 100 ? s[humCode] / 10 : s[humCode];
  if ('battery_percentage' in s) state.battery = s.battery_percentage;
  if ('doorcontact_state' in s) state.open = Boolean(s.doorcontact_state);

  if ('temp_set' in s) {
    meta.tempScale = tempScale(s.temp_set);
    state.targetTemperature = s.temp_set / meta.tempScale;
    capabilities.push('thermostat');
  }
  // Energy-monitoring plugs: power in 0.1 W, voltage in 0.1 V, current in mA.
  if ('cur_power' in s) {
    meta.metered = true;
    state.powerW = Math.round(Number(s.cur_power) || 0) / 10;
    if ('cur_voltage' in s) state.voltageV = Math.round(Number(s.cur_voltage) || 0) / 10;
    if ('cur_current' in s) state.currentA = Math.round(Number(s.cur_current) || 0) / 1000;
  }

  if ('control' in s) {
    capabilities.push('cover');
    if ('percent_control' in s) state.position = s.percent_control;
  }

  return {
    providerId: d.id,
    name: d.name,
    type: CATEGORY_TYPES[d.category] ?? (capabilities.includes('onoff') ? 'switch' : 'other'),
    model: d.product_name ?? null,
    online: Boolean(d.online),
    state,
    capabilities,
    meta,
    suggestedRoom: null,
  };
}

export default {
  id: 'tuya',
  requiredConfig: ['clientId', 'clientSecret'],
  configFields: ['clientId', 'clientSecret', 'endpoint', 'uid'],

  async listDevices(cfg) {
    let devices = [];
    if (cfg.uid) {
      devices = await call(cfg, 'GET', `/v1.0/users/${cfg.uid}/devices`);
    } else {
      let lastRowKey;
      do {
        const r = await call(cfg, 'GET', '/v1.0/iot-01/associated-users/devices', {
          query: { size: 100, last_row_key: lastRowKey },
        });
        devices.push(...(r.devices ?? []));
        lastRowKey = r.has_more ? r.last_row_key : undefined;
      } while (lastRowKey);
    }
    const out = devices.map(normalize);
    // Daily energy (kWh) for the last 30 days, for plugs that measure it. Not every product keeps
    // these statistics in the Tuya cloud; those just show the power right now.
    const ymd = (t) => new Date(t - 5 * 3600_000).toISOString().slice(0, 10).replace(/-/g, ''); // local day (UTC-5)
    for (const d of out.filter((x) => x.meta.metered)) {
      try {
        const r = await call(cfg, 'GET', `/v1.0/devices/${d.providerId}/statistics/days`, {
          query: { code: 'add_ele', start_day: ymd(Date.now() - 29 * 86400_000), end_day: ymd(Date.now()) },
        });
        const days = Object.entries(r?.days ?? {})
          .map(([k, v]) => ({ day: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`, kwh: Math.round(Number(v) * 1000) / 1000 }))
          .filter((x) => Number.isFinite(x.kwh))
          .sort((a, b) => a.day.localeCompare(b.day));
        if (days.length) {
          d.state.energyDays = days;
          d.state.todayKwh = days.find((x) => x.day === `${ymd(Date.now()).slice(0, 4)}-${ymd(Date.now()).slice(4, 6)}-${ymd(Date.now()).slice(6)}`)?.kwh ?? 0;
        }
      } catch (e) {
        d.meta.statsError = String(e.message).slice(0, 120);
      }
    }
    return out;
  },

  async command(cfg, device, action, value) {
    const m = device.meta ?? {};
    let commands;
    let patch;
    switch (action) {
      case 'setOn':
        commands = [{ code: m.switchCode, value: Boolean(value) }];
        patch = { on: Boolean(value) };
        break;
      case 'setBrightness': {
        const raw = Math.round(m.brightMin + (value / 100) * (m.brightMax - m.brightMin));
        commands = [{ code: m.brightCode, value: raw }];
        patch = { brightness: value };
        break;
      }
      case 'setTemperature':
        commands = [{ code: 'temp_set', value: Math.round(value * (m.tempScale ?? 1)) }];
        patch = { targetTemperature: value };
        break;
      case 'cover':
        commands = [{ code: 'control', value }];
        patch = {};
        break;
      default:
        throw new ProviderError(`Tuya devices do not support "${action}".`, 400);
    }
    if (!commands[0].code) throw new ProviderError(`${device.name} does not support "${action}".`, 400);
    await call(cfg, 'POST', `/v1.0/iot-03/devices/${device.providerId}/commands`, { body: { commands } });
    return patch;
  },
};
