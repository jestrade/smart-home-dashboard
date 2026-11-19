// Enphase systems via the Enlighten Systems API v4 (read-only).
// Create an app at https://developer-v4.enphase.com to get an API key, client id and client secret,
// register the redirect URI shown on the card, then press Connect (OAuth 2.0 authorization code).
// Every call needs the bearer token and the app's API key (`key` query parameter).
// Quota: the free Watt plan allows about 1,000 calls a month, while the dashboard syncs every
// 15 minutes, so results are cached in the server-only integration doc for `pollMinutes` (default 60).
import { logger } from 'firebase-functions';
import { fetchJson, ProviderError } from '../lib/http.js';
import { ensureAccessToken } from '../lib/oauth.js';

const API = 'https://api.enphaseenergy.com/api/v4';
const AUTH = 'https://api.enphaseenergy.com/oauth';
const DEFAULT_POLL_MINUTES = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const oauth = {
  tokenUrl: `${AUTH}/token`,
  basicAuth: true,
  // unverified: whether Enphase honours PKCE; the extra parameters are ignored if not.
  authorizeUrl(cfg, { redirectUri, state, challenge }) {
    const params = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, redirect_uri: redirectUri, state });
    if (challenge) {
      params.set('code_challenge', challenge);
      params.set('code_challenge_method', 'S256');
    }
    return `${AUTH}/authorize?${params}`;
  },
};

// Same unit tables as Solis: values are scaled to kW / kWh.
const POWER = { W: 0.001, kW: 1, MW: 1000, GW: 1e6 };
const ENERGY = { Wh: 0.001, kWh: 1, MWh: 1000, GWh: 1e6 };
const scaled = (table) => (v, unit, fallback) => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return undefined;
  return Math.round(Number(v) * (table[unit] ?? table[fallback] ?? 1) * 1000) / 1000;
};
export const toKw = scaled(POWER);
export const toKwh = scaled(ENERGY);
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

const clean = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v]),
  );

async function optional(label, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.status === 401) throw e; // a rejected token must surface as "reconnect needed"
    logger.info(`enphase ${label} unavailable: ${e.message}`);
    return null;
  }
}

/** System `status` from /summary → [label, 'ok'|'offline'|'alarm']. */
export function enphaseStatus(status) {
  const s = String(status ?? '').trim().toLowerCase();
  const label = s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Unknown';
  if (s === 'normal') return ['Normal', 'ok'];
  // unverified: Enphase reports "comm" when the gateway stops reporting.
  if (s === 'comm' || s === 'offline' || s === '') return [s === 'comm' ? 'Not reporting' : label, 'offline'];
  return [label, 'alarm'];
}

/** Systems to read: the configured ids (comma separated) or the cached / listed ones. */
const configuredIds = (cfg) =>
  String(cfg.systemId ?? '')
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

async function call(cfg, ctx, path) {
  const token = await ensureAccessToken(oauth, cfg, ctx);
  const qs = new URLSearchParams({ key: cfg.apiKey });
  let r;
  try {
    r = await fetchJson(`${API}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new ProviderError('Enphase rejected the token or API key. Reconnect on the Integrations tab.', 401);
    if (e.status === 429) throw new ProviderError('Enphase API quota reached; raise pollMinutes or wait.', 429);
    throw e;
  }
  await sleep(600); // free plan: about 10 requests a minute
  return r;
}

function systemDevice(id, sys, summary) {
  const s = summary ?? {};
  const capacityKwp = toKw(s.size_w, 'W');
  const [label, group] = summary ? enphaseStatus(s.status) : ['Unknown', 'offline'];
  const todayKwh = toKwh(s.energy_today, 'Wh');
  const totalKwh = toKwh(s.energy_lifetime, 'Wh');
  // unverified: summary field names and units (W / Wh, last_report_at in epoch seconds).
  const reported = num(s.last_report_at);

  const state = {
    statusLabel: label,
    solarStatus: group,
    powerKw: toKw(s.current_power, 'W'),
    capacityKwp,
    todayKwh,
    totalKwh,
    periods: { day: { producedKwh: todayKwh }, total: { producedKwh: totalKwh } },
    reportedAt: reported ? new Date(reported * 1000).toISOString() : undefined,
  };

  return {
    providerId: String(id),
    name: sys?.name ?? s.name ?? `Enphase system ${id}`,
    type: 'solar',
    model: capacityKwp ? `${capacityKwp} kWp` : null,
    online: group !== 'offline',
    state: clean(state),
    capabilities: [],
    meta: clean({ stationId: String(id), capacityKwp }),
    suggestedRoom: 'Roof',
  };
}

export default {
  id: 'enphase',
  oauth,
  requiredConfig: ['clientId', 'clientSecret', 'apiKey'],
  configFields: ['clientId', 'clientSecret', 'apiKey', 'systemId', 'pollMinutes', 'redirectUri'],

  async listDevices(cfg, ctx) {
    const pollMs = Math.max(0, num(cfg.pollMinutes) ?? DEFAULT_POLL_MINUTES) * 60_000;
    const cacheKey = configuredIds(cfg).join(',');

    // Budget guard: reuse the last result until pollMinutes have passed (no vendor call).
    if (Array.isArray(cfg.cachedDevices) && cfg.cachedDevices.length && cfg.cacheKey === cacheKey && Date.now() - (num(cfg.cachedAt) ?? 0) < pollMs) {
      return cfg.cachedDevices;
    }

    // System ids: configured, cached from an earlier listing, or listed once.
    let systems = configuredIds(cfg).map((id) => ({ system_id: id }));
    if (systems.length === 0 && Array.isArray(cfg.systemIds) && cfg.systemIds.length) systems = cfg.systemIds;
    if (systems.length === 0) {
      const list = await call(cfg, ctx, '/systems');
      systems = (list?.systems ?? []).map((s) => clean({ system_id: String(s.system_id), name: s.name }));
      if (systems.length) await ctx.saveConfig({ systemIds: systems });
    }
    if (systems.length === 0) throw new ProviderError('No solar plants found on this Enphase account.', 404);

    const out = [];
    let lastError = null;
    for (const sys of systems) {
      // sequential: plan rate limit. One failing system degrades to a status-only card.
      const id = sys.system_id;
      const summary = await optional(`summary ${id}`, () =>
        call(cfg, ctx, `/systems/${encodeURIComponent(id)}/summary`).catch((e) => {
          lastError = e;
          throw e;
        }),
      );
      out.push(systemDevice(id, sys, summary));
    }
    if (lastError && out.every((d) => d.state.statusLabel === 'Unknown')) throw lastError; // nothing usable: fail the sync

    // Device objects only: no tokens or keys go into the cache.
    await ctx.saveConfig({ cachedDevices: out, cachedAt: Date.now(), cacheKey });
    return out;
  },

  async command() {
    throw new ProviderError('The Enphase integration is read-only.', 400);
  },
};
