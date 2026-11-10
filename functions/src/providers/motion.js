// Motion Blinds (Coulisse) through a home bridge (bridge/motion-bridge.mjs).
// The Motion gateway API is LAN-only, so the bridge reports state and executes queued commands.
import { ProviderError } from '../lib/http.js';
import { queueAndWait } from '../lib/bridge.js';

const STALE_MS = 10 * 60 * 1000;

export const BLIND_TYPES = {
  1: 'Roller blind', 2: 'Venetian blind', 3: 'Roman blind', 4: 'Honeycomb blind', 5: 'Shangri-La blind',
  6: 'Roller shutter', 7: 'Roller gate', 8: 'Awning', 9: 'Top-down bottom-up', 10: 'Day & night blind',
  11: 'Dimming blind', 12: 'Curtain', 13: 'Curtain (left)', 14: 'Curtain (right)', 22: 'Double roller',
  42: 'Switch', 43: 'Skylight',
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Keep only expected fields from a bridge report. */
export function sanitize(d) {
  if (!d || typeof d.mac !== 'string' || !/^[0-9a-fA-F]{12,16}$/.test(d.mac)) return null;
  const pos = num(d.position);
  return {
    mac: d.mac.toLowerCase(),
    type: num(d.type) ?? null,
    position: pos == null ? null : Math.max(0, Math.min(100, Math.round(pos))), // Motion: 0 = open, 100 = closed
    angle: num(d.angle) ?? null,
    batteryVolts: num(d.batteryVolts) ?? null,
    rssi: num(d.rssi) ?? null,
    online: d.online !== false,
  };
}

function normalize(d) {
  const state = {};
  if (d.position != null) {
    state.position = 100 - d.position; // dashboard: % open
    state.open = d.position < 100;
  }
  if (d.batteryVolts) state.batteryVolts = Math.round(d.batteryVolts * 100) / 100;
  if (d.rssi != null) state.rssi = d.rssi;
  return {
    providerId: d.mac,
    name: `Motion blind ${d.mac.slice(-4).toUpperCase()}`,
    type: 'cover',
    model: BLIND_TYPES[d.type] ?? 'Motion blind',
    online: d.online,
    state,
    capabilities: ['cover', 'position'],
    meta: { mac: d.mac },
    suggestedRoom: null,
  };
}

export default {
  id: 'motion',
  bridge: true,
  requiredConfig: ['bridgeTokenHash'],
  configFields: [],
  // Connected once the bridge has reported at least once.
  isConnected: (cfg) => Boolean(cfg.bridgeTokenHash && cfg.lastReportAt),

  async listDevices(cfg) {
    const age = Date.now() - (cfg.lastReportAt ?? 0);
    if (age > STALE_MS) {
      throw new ProviderError(`The Motion bridge has not reported for ${Math.round(age / 60000)} minutes. Is it running?`, 503);
    }
    return (cfg.devices ?? []).map(normalize);
  },

  async command(cfg, device, action, value) {
    if (Date.now() - (cfg.lastReportAt ?? 0) > STALE_MS) {
      throw new ProviderError('The Motion bridge is offline, so the blind cannot be moved right now.', 503);
    }
    if (action !== 'cover' && action !== 'setPosition') throw new ProviderError(`Motion blinds do not support "${action}".`, 400);
    const r = await queueAndWait('motion', { deviceId: device.providerId, action, value });
    if (!r.ok) throw new ProviderError(r.error, 504);
    if (action === 'setPosition') return { position: value, open: value > 0 };
    if (value === 'open') return { position: 100, open: true };
    if (value === 'close') return { position: 0, open: false };
    return {};
  },
};
