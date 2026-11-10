// Imou Life cameras via the Imou Open API (open.imoulife.com).
// Docs: https://open.imoulife.com/book/en/http/develop.html
import crypto from 'node:crypto';
import { fetchJson, ProviderError } from '../lib/http.js';

const DEFAULT_ENDPOINT = 'https://openapi-or.easy4ip.com'; // Oregon (Americas)
const tokenCache = new Map(); // appId -> { token, expiresAt }

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

async function rpc(cfg, method, params = {}) {
  const time = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const body = {
    system: { ver: '1.0', appId: cfg.appId, sign: md5(`time:${time},nonce:${nonce},appSecret:${cfg.appSecret}`), time, nonce },
    id: nonce,
    params,
  };
  const base = (cfg.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
  const r = await fetchJson(`${base}/openapi/${method}`, { method: 'POST', body });
  const res = r?.result;
  if (res?.code !== '0') {
    const code = res?.code ?? '?';
    const authError = ['OP1008', 'OP1009', 'SN1001', 'SN1002', 'TK1002', 'TK1003'].includes(code);
    throw new ProviderError(`Imou ${method}: ${res?.msg ?? 'unknown error'} (${code})`, authError ? 401 : 400);
  }
  return res.data ?? {};
}

async function token(cfg) {
  const cached = tokenCache.get(cfg.appId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const d = await rpc(cfg, 'accessToken');
  tokenCache.set(cfg.appId, { token: d.accessToken, expiresAt: Date.now() + (Number(d.expireTime) || 3600) * 1000 });
  return d.accessToken;
}

async function call(cfg, method, params = {}) {
  try {
    return await rpc(cfg, method, { token: await token(cfg), ...params });
  } catch (e) {
    if (e.status !== 401) throw e;
    tokenCache.delete(cfg.appId); // expired token: retry once
    return rpc(cfg, method, { token: await token(cfg), ...params });
  }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const has = (ability, name) => String(ability ?? '').split(',').map((s) => s.trim()).includes(name);

export default {
  id: 'imou',
  requiredConfig: ['appId', 'appSecret'],
  configFields: ['appId', 'appSecret', 'endpoint'],

  async listDevices(cfg) {
    const base = await call(cfg, 'deviceBaseList', { bindId: -1, limit: 128, type: 'bindAndShare', needApInfo: false });
    const list = base.deviceList ?? [];
    if (list.length === 0) return [];

    const details = [];
    for (const group of chunk(list, 10)) {
      const d = await call(cfg, 'deviceBaseDetailList', {
        deviceList: group.map((x) => ({
          deviceId: x.deviceId,
          channelList: (x.channels ?? [{ channelId: '0' }]).map((c) => c.channelId).join(','),
        })),
      });
      details.push(...(d.deviceList ?? []));
    }

    const out = [];
    for (const dev of details) {
      const channels = dev.channelList?.length ? dev.channelList : [{ channelId: '0', channelName: dev.deviceName }];
      for (const ch of channels) {
        const online = (ch.channelStatus ?? dev.deviceStatus) === 'online';
        const privacySupported = has(dev.ability, 'CloseCamera') || has(ch.channelAbility, 'CloseCamera');
        const state = {};
        const capabilities = ['snapshot'];
        if (privacySupported && online) {
          try {
            const st = await call(cfg, 'getDeviceCameraStatus', { deviceId: dev.deviceId, channelId: ch.channelId, enableType: 'closeCamera' });
            state.on = st.status !== 'on'; // privacy mode on = camera off
            capabilities.unshift('onoff');
          } catch {
            /* status not available for this model */
          }
        }
        if (ch.channelPicUrl) state.imageUrl = ch.channelPicUrl;
        out.push({
          providerId: channels.length > 1 ? `${dev.deviceId}_${ch.channelId}` : dev.deviceId,
          name: (channels.length > 1 ? ch.channelName : dev.deviceName) || ch.channelName || dev.deviceId,
          type: 'camera',
          model: dev.deviceModel ?? null,
          online,
          state,
          capabilities,
          meta: { deviceId: dev.deviceId, channelId: String(ch.channelId), firmware: dev.deviceVersion ?? null },
          suggestedRoom: null,
        });
      }
    }
    return out;
  },

  async command(cfg, device, action, value) {
    const { deviceId, channelId } = device.meta ?? {};
    if (action === 'setOn') {
      // "on" means the camera is active, i.e. privacy mode (closeCamera) disabled.
      await call(cfg, 'setDeviceCameraStatus', { deviceId, channelId, enableType: 'closeCamera', enable: !value });
      return { on: Boolean(value) };
    }
    if (action === 'snapshot') {
      const d = await call(cfg, 'setDeviceSnapEnhanced', { deviceId, channelId });
      if (!d.url) throw new ProviderError('Imou returned no snapshot.', 502);
      return { snapshotUrl: d.url, snapshotAt: new Date().toISOString() };
    }
    throw new ProviderError(`Imou: "${action}" is not supported.`, 400);
  },
};
