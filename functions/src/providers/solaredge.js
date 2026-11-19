// SolarEdge sites via the SolarEdge Monitoring API (read-only).
// Get a key in the monitoring portal: Admin → Site Access → API access (account- or site-level key).
// Docs: https://knowledge-center.solaredge.com/sites/kc/files/se_monitoring_api.pdf
// Quota: about 300 requests a day per key and site, 3 at a time (unverified), and the dashboard
// syncs every 15 minutes, so each sync makes only sites/list + one overview per site.
import { fetchJson, ProviderError } from '../lib/http.js';

const API = 'https://monitoringapi.solaredge.com';
const STALE_MS = 2 * 3600_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same unit tables as Solis: values are scaled to kW / kWh.
const POWER = { W: 0.001, kW: 1, MW: 1000, GW: 1e6 };
const ENERGY = { Wh: 0.001, kWh: 1, MWh: 1000, GWh: 1e6 };
const scaled = (table) => (v, unit, fallback) => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return undefined;
  return Math.round(Number(v) * (table[unit] ?? table[fallback] ?? 1) * 1000) / 1000;
};
export const toKw = scaled(POWER);
export const toKwh = scaled(ENERGY);

const clean = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v]),
  );

/** Site status from /sites/list → [label, 'ok'|'offline'|'alarm']. */
export function solaredgeStatus(status) {
  const s = String(status ?? '').trim();
  if (/^active$/i.test(s)) return ['Active', 'ok'];
  if (/^pending$/i.test(s)) return ['Pending', 'offline'];
  return [s || 'Unknown', 'alarm'];
}

/** "YYYY-MM-DD HH:MM:SS" in the site's IANA time zone → ISO string (UTC). */
export function localToIso(text, timeZone) {
  const m = String(text ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return undefined;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let offsetMs = 0;
  try {
    // Offset of the zone at that moment: format the instant in the zone and compare.
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(asUtc))
        .map((p) => [p.type, p.value]),
    );
    const zoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    offsetMs = zoned - asUtc;
  } catch {
    offsetMs = 0; // unknown zone: treat as UTC
  }
  return new Date(asUtc - offsetMs).toISOString();
}

async function call(cfg, path, params = {}) {
  const qs = new URLSearchParams({ ...params, api_key: cfg.apiKey });
  let r;
  try {
    r = await fetchJson(`${API}${path}?${qs}`);
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new ProviderError('SolarEdge rejected the API key.', 401);
    // fetchJson only puts the pathname in the message; redact the key anyway in case the body echoes it.
    throw new ProviderError(String(e.message).split(cfg.apiKey).join('***'), e.status ?? 500);
  }
  await sleep(400); // stay under the 3-concurrent / daily quota
  return r;
}

async function siteState(cfg, site) {
  const id = site.id;
  const r = await call(cfg, `/site/${encodeURIComponent(id)}/overview`);
  const o = r?.overview ?? {};
  const capacityKwp = toKw(site.peakPower, 'kW');
  const reportedAt = localToIso(o.lastUpdateTime, site.location?.timeZone);

  let [label, group] = solaredgeStatus(site.status);
  if (group === 'ok' && reportedAt && Date.now() - Date.parse(reportedAt) > STALE_MS) [label, group] = ['No recent data', 'offline'];

  const todayKwh = toKwh(o.lastDayData?.energy, 'Wh');
  const monthKwh = toKwh(o.lastMonthData?.energy, 'Wh');
  const yearKwh = toKwh(o.lastYearData?.energy, 'Wh');
  const totalKwh = toKwh(o.lifeTimeData?.energy, 'Wh');

  const state = {
    statusLabel: label,
    solarStatus: group,
    powerKw: toKw(o.currentPower?.power, 'W'),
    capacityKwp,
    todayKwh,
    monthKwh,
    yearKwh,
    totalKwh,
    periods: {
      day: { producedKwh: todayKwh },
      month: { producedKwh: monthKwh },
      year: { producedKwh: yearKwh },
      total: { producedKwh: totalKwh },
    },
    reportedAt,
  };

  return {
    providerId: String(id),
    name: site.name ?? `SolarEdge site ${id}`,
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
  id: 'solaredge',
  requiredConfig: ['apiKey'],
  configFields: ['apiKey', 'siteId'],

  async listDevices(cfg) {
    const list = await call(cfg, '/sites/list', { size: 10 });
    let sites = list?.sites?.site ?? [];
    if (!Array.isArray(sites)) sites = [sites];
    const wanted = String(cfg.siteId ?? '').trim();
    if (wanted) sites = sites.filter((s) => String(s.id) === wanted);
    if (sites.length === 0) {
      throw new ProviderError(wanted ? `SolarEdge site ${wanted} was not found for this API key.` : 'No solar plants found on this SolarEdge account.', 404);
    }
    const out = [];
    for (const s of sites) out.push(await siteState(cfg, s)); // sequential: API concurrency limit
    return out;
  },

  async command() {
    throw new ProviderError('The SolarEdge integration is read-only.', 400);
  },
};
