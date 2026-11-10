// SolisCloud solar inverters via the SolisCloud Platform API (read-only).
// Enable it in SolisCloud: Account → Basic settings → API management → Activate, to get a KeyId and KeySecret.
// Signing: HMAC-SHA1 over "POST\n{Content-MD5}\n{Content-Type}\n{Date}\n{path}".
import crypto from 'node:crypto';
import { logger } from 'firebase-functions';
import { fetchJson, ProviderError } from '../lib/http.js';

const DEFAULT_API = 'https://www.soliscloud.com:13333';
const CONTENT_TYPE = 'application/json';
const STATE = { 1: ['Online', 'ok'], 2: ['Offline', 'offline'], 3: ['Alarm', 'alarm'] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function signRequest(keyId, keySecret, path, body, date = new Date().toUTCString()) {
  const md5 = crypto.createHash('md5').update(body).digest('base64');
  const toSign = `POST\n${md5}\n${CONTENT_TYPE}\n${date}\n${path}`;
  const sign = crypto.createHmac('sha1', keySecret).update(toSign).digest('base64');
  return { 'Content-MD5': md5, 'Content-Type': CONTENT_TYPE, Date: date, Authorization: `API ${keyId}:${sign}` };
}

async function call(cfg, path, params) {
  const body = JSON.stringify(params);
  const base = (cfg.endpoint || DEFAULT_API).replace(/\/$/, '');
  let r;
  try {
    r = await fetchJson(`${base}${path}`, { method: 'POST', headers: signRequest(cfg.keyId, cfg.keySecret, path, body), body });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new ProviderError('SolisCloud rejected the KeyId/KeySecret.', 401);
    throw e;
  }
  if (r?.success === false || (r?.code != null && String(r.code) !== '0')) {
    throw new ProviderError(`SolisCloud ${path}: ${r?.msg ?? 'error'} (${r?.code})`, 400);
  }
  // SolisCloud allows only a few requests per second per endpoint.
  await sleep(350);
  return r?.data;
}

// Values come with a unit string next to them (e.g. power + powerStr: "W" | "kW" | "MW").
const POWER = { W: 0.001, kW: 1, MW: 1000, GW: 1e6 };
const ENERGY = { Wh: 0.001, kWh: 1, MWh: 1000, GWh: 1e6 };
const scaled = (table) => (v, unit, fallback) => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return undefined;
  return Math.round(Number(v) * (table[unit] ?? table[fallback] ?? 1) * 1000) / 1000;
};
const kw = scaled(POWER);
const kwh = scaled(ENERGY);
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

/** yyyy-mm-dd / yyyy-mm in the station's own time zone (offset in hours). */
function localDate(offsetHours, daysAgo = 0) {
  const d = new Date(Date.now() + (offsetHours ?? 0) * 3600_000 - daysAgo * 86400_000);
  return d.toISOString().slice(0, 10);
}

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
    logger.info(`solis ${label} unavailable: ${e.message}`);
    return null;
  }
}

async function stationState(cfg, station) {
  const id = station.id;
  const d = (await call(cfg, '/v1/api/stationDetail', { id })) ?? {};
  const tz = num(d.timeZone ?? station.timeZone) ?? 0;
  const money = d.money ?? station.money;
  const today = localDate(tz);

  // Today's production curve, downsampled to 15-minute points.
  const dayPoints = (await optional('stationDay', () => call(cfg, '/v1/api/stationDay', { id, money, time: today, timeZone: tz }))) ?? [];
  const curve = [];
  let lastSlot = null;
  for (const p of Array.isArray(dayPoints) ? dayPoints : []) {
    const label = String(p.timeStr ?? '').slice(11, 16); // "HH:MM"
    if (!label) continue;
    const slot = label.slice(0, 3) + String(Math.floor(Number(label.slice(3)) / 15) * 15).padStart(2, '0');
    if (slot === lastSlot) continue;
    lastSlot = slot;
    curve.push({ t: label, kw: kw(p.power, p.powerStr, 'kW') ?? 0 });
  }

  // Daily energy for the last 30 days (current + previous month).
  const thisMonth = today.slice(0, 7);
  const prevMonth = localDate(tz, Number(today.slice(8, 10)) + 1).slice(0, 7);
  const monthRows = [];
  for (const month of [prevMonth, thisMonth]) {
    const rows = await optional(`stationMonth ${month}`, () => call(cfg, '/v1/api/stationMonth', { id, money, month, timeZone: tz }));
    if (Array.isArray(rows)) monthRows.push(...rows);
  }
  const days = monthRows
    .map((r) => ({ day: String(r.dateStr ?? '').slice(0, 10), kwh: kwh(r.energy, r.energyStr, 'kWh') }))
    .filter((r) => r.day && r.kwh != null && r.day <= today)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);

  const inv = await optional('inverterList', () => call(cfg, '/v1/api/inverterList', { pageNo: 1, pageSize: 20, stationId: id }));
  const inverters = (inv?.page?.records ?? []).map((x) => ({
    sn: x.sn,
    model: x.productModel ?? x.machine ?? x.inverterMeterModel,
    state: STATE[x.state]?.[0] ?? 'Unknown',
    kw: kw(x.pac, x.pacStr, 'kW'),
    todayKwh: kwh(x.etoday, x.etodayStr, 'kWh'),
    totalKwh: kwh(x.etotal, x.etotalStr, 'kWh'),
  }));

  const [label, group] = STATE[d.state ?? station.state] ?? ['Unknown', 'offline'];
  const capacityKwp = kw(d.capacity ?? station.capacity, d.capacityStr ?? station.capacityStr, 'kW');
  const powerKw = kw(d.power ?? station.power, d.powerStr ?? station.powerStr, 'kW');

  const state = {
    statusLabel: label,
    solarStatus: group,
    powerKw,
    capacityKwp,
    todayKwh: kwh(d.dayEnergy ?? station.dayEnergy, d.dayEnergyStr ?? station.dayEnergyStr, 'kWh'),
    monthKwh: kwh(d.monthEnergy, d.monthEnergyStr, 'kWh'),
    yearKwh: kwh(d.yearEnergy, d.yearEnergyStr, 'kWh'),
    totalKwh: kwh(d.allEnergy ?? station.allEnergy, d.allEnergyStr ?? station.allEnergyStr, 'kWh'),
    income: { today: num(d.dayIncome), month: num(d.monthIncome), total: num(d.allIncome), currency: money },
    flow: {
      homeLoadKw: kw(d.familyLoadPower, d.familyLoadPowerStr, 'kW'),
      gridKw: kw(d.psum, d.psumStr, 'kW'),
      batteryKw: kw(d.batteryPower, d.batteryPowerStr, 'kW'),
      batteryPercent: num(d.batteryPercent),
    },
    todayGrid: {
      boughtKwh: kwh(d.gridPurchasedTodayEnergy, d.gridPurchasedTodayEnergyStr, 'kWh'),
      soldKwh: kwh(d.gridSellTodayEnergy, d.gridSellTodayEnergyStr, 'kWh'),
      homeKwh: kwh(d.homeLoadTodayEnergy, d.homeLoadTodayEnergyStr, 'kWh'),
    },
    peakSunHours: num(d.fullHour),
    curve,
    days,
    inverters,
    timezoneHours: tz,
    reportedAt: num(d.dataTimestamp ?? station.dataTimestamp) ? new Date(Number(d.dataTimestamp ?? station.dataTimestamp)).toISOString() : undefined,
  };

  return {
    providerId: String(id),
    name: d.stationName ?? station.stationName ?? `Solar station ${id}`,
    type: 'solar',
    model: capacityKwp ? `${capacityKwp} kWp` : null,
    online: group !== 'offline',
    state: clean(state),
    capabilities: [],
    meta: { stationId: String(id) },
    suggestedRoom: 'Roof',
  };
}

export default {
  id: 'solis',
  requiredConfig: ['keyId', 'keySecret'],
  configFields: ['keyId', 'keySecret', 'endpoint'],

  async listDevices(cfg) {
    const list = await call(cfg, '/v1/api/userStationList', { pageNo: 1, pageSize: 20 });
    const stations = list?.page?.records ?? [];
    if (stations.length === 0) throw new ProviderError('No solar stations found on this SolisCloud account.', 404);
    const out = [];
    for (const s of stations) out.push(await stationState(cfg, s)); // sequential: API rate limits
    return out;
  },

  async command() {
    throw new ProviderError('The SolisCloud integration is read-only.', 400);
  },
};
