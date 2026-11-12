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
    throw Object.assign(new ProviderError(`Imou ${method}: ${res?.msg ?? 'unknown error'} (${code})`, authError ? 401 : 400), { code });
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

    // Field names follow the real deviceBaseDetailList response:
    // device { name, status, deviceModel, catalog, ability, version, channels: [{ channelId, channelName, status, picUrl, ability }] }
    const out = [];
    for (const dev of details) {
      const model = dev.deviceModel ?? dev.catalog ?? null;
      const devName = dev.name || dev.deviceName || dev.deviceId;
      // IoT accessories (gateways, sensors, plugs) have ids like "<hub>_<sn>_<x>" or IOT_* models: not cameras.
      const isCamera = !/^IOT/i.test(model ?? '') && !String(dev.deviceId).includes('_');
      const channels = isCamera && dev.channels?.length ? dev.channels : [{ channelId: '0', channelName: devName }];
      const multi = channels.length > 1;

      for (const ch of channels) {
        const status = ch.status ?? dev.status ?? dev.deviceStatus;
        // Battery cameras report "sleep": reachable, but they wake on demand.
        const online = status === 'online' || status === 'sleep';
        const state = {};
        const capabilities = [];
        if (status === 'sleep') state.sleeping = true;
        if (isCamera) {
          capabilities.push('snapshot', 'live');
          const privacySupported = has(dev.ability, 'CloseCamera') || has(ch.ability, 'CloseCamera');
          if (privacySupported && status === 'online') {
            try {
              const st = await call(cfg, 'getDeviceCameraStatus', { deviceId: dev.deviceId, channelId: ch.channelId, enableType: 'closeCamera' });
              state.on = st.status !== 'on'; // privacy mode on = camera off
              capabilities.unshift('onoff');
            } catch {
              /* not available for this model */
            }
          }
          if (ch.picUrl) state.imageUrl = ch.picUrl;
        }
        const chName = ch.channelName && ch.channelName !== devName ? ch.channelName : null;
        out.push({
          providerId: multi ? `${dev.deviceId}_${ch.channelId}` : dev.deviceId,
          name: multi ? `${devName} · ${chName ?? `Lens ${Number(ch.channelId) + 1}`}` : devName,
          type: isCamera ? 'camera' : 'other',
          model,
          online,
          state,
          capabilities,
          meta: { deviceId: dev.deviceId, channelId: String(ch.channelId), firmware: dev.version ?? dev.deviceVersion ?? null },
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
    if (action === 'live') {
      // A live address (HLS) for the browser. Imou keeps one per camera, so reuse it when it exists.
      let d;
      try {
        d = await call(cfg, 'bindDeviceLive', { deviceId, channelId, streamId: 1 });
      } catch (e) {
        if (e.code !== 'LV1001') throw e; // LV1001: a live address already exists
        d = await call(cfg, 'getLiveStreamInfo', { deviceId, channelId });
      }
      const streams = (d.streams ?? []).filter((x) => /^https:/.test(x.hls ?? ''));
      const stream = streams.find((x) => Number(x.streamId) === 1) ?? streams[0];
      if (!stream) throw new ProviderError('Imou returned no live video address for this camera.', 502);
      return { liveUrl: stream.hls, liveAt: new Date().toISOString() };
    }
    throw new ProviderError(`Imou: "${action}" is not supported.`, 400);
  },
};
