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

// Money comes in display units ("K COP", "M COP"): turn it back into plain currency units.
const MONEY_SCALE = { K: 1e3, M: 1e6, B: 1e9 };
function money(v, unit) {
  const x = num(v);
  if (x == null) return undefined;
  const prefix = String(unit ?? '').trim().split(' ')[0];
  return Math.round(x * (prefix.length === 1 && MONEY_SCALE[prefix] ? MONEY_SCALE[prefix] : 1));
}

/** One period's energy balance from a stationMonth/Year/All row (kWh). */
const balanceRow = (r) => ({
  producedKwh: kwh(r.produceEnergy ?? r.energy, r.energyStr, 'kWh'),
  consumedKwh: kwh(r.consumeEnergy ?? r.homeLoadEnergy, 'kWh'),
  importKwh: kwh(r.gridPurchasedEnergy, 'kWh'),
  exportKwh: kwh(r.gridSellEnergy, 'kWh'),
  selfKwh: kwh(r.oneSelf, 'kWh'),
  income: num(r.money),
  fullHours: num(r.fullHour),
});

const sumRows = (rows) => {
  const out = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (typeof v === 'number' && k !== 'fullHours') out[k] = Math.round(((out[k] ?? 0) + v) * 1000) / 1000;
  return out;
};

/** Solar power used at home = produced − exported (never below zero or above what the home used). */
function withSelf(p) {
  if (p.producedKwh == null) return p;
  const self = p.selfKwh ?? (p.exportKwh != null ? Math.max(0, p.producedKwh - p.exportKwh) : undefined);
  return { ...p, selfKwh: self == null ? undefined : Math.round(Math.min(self, p.consumedKwh ?? self) * 1000) / 1000 };
}

async function stationState(cfg, station) {
  const id = station.id;
  const d = (await call(cfg, '/v1/api/stationDetail', { id })) ?? {};
  const tz = num(d.timeZone ?? station.timeZone) ?? 0;
  const currency = d.money ?? station.money;
  const today = localDate(tz);
  const capacityKwp = kw(d.capacity ?? station.capacity, d.capacityStr ?? station.capacityStr, 'kW');

  // Today, every 5 minutes: solar, home and grid power. The rows' unit label says kW but the values
  // are in watts, so the unit is decided from the size of the numbers against the plant's capacity.
  const dayPoints = (await optional('stationDay', () => call(cfg, '/v1/api/stationDay', { id, money: currency, time: today, timeZone: tz }))) ?? [];
  const rows = Array.isArray(dayPoints) ? dayPoints : [];
  const peak = Math.max(0, ...rows.map((p) => Math.abs(num(p.power) ?? 0)), ...rows.map((p) => Math.abs(num(p.familyLoadPower) ?? 0)));
  const toKw = peak > (capacityKwp ?? 10) * 3 ? (v) => (num(v) == null ? undefined : Math.round(num(v)) / 1000) : (v) => num(v);
  const curve = [];
  let lastSlot = null;
  for (const p of rows) {
    const label = String(p.timeStr ?? '').match(/(\d{2}):(\d{2})/)?.[0]; // "HH:MM", with or without a date in front
    if (!label) continue;
    const slot = label.slice(0, 3) + String(Math.floor(Number(label.slice(3)) / 15) * 15).padStart(2, '0');
    if (slot === lastSlot) continue; // one point per 15 minutes
    lastSlot = slot;
    curve.push(clean({ t: label, kw: toKw(p.power) ?? 0, homeKw: toKw(p.familyLoadPower), gridKw: toKw(p.psum) }));
  }

  // Daily balance for the last 30 days (current + previous month).
  const thisMonth = today.slice(0, 7);
  const prevMonth = localDate(tz, Number(today.slice(8, 10)) + 1).slice(0, 7);
  const monthRows = [];
  for (const month of [prevMonth, thisMonth]) {
    const r = await optional(`stationMonth ${month}`, () => call(cfg, '/v1/api/stationMonth', { id, money: currency, month, timeZone: tz }));
    if (Array.isArray(r)) monthRows.push(...r);
  }
  const days = monthRows
    .map((r) => clean({ day: String(r.dateStr ?? '').slice(0, 10), kwh: kwh(r.energy, r.energyStr, 'kWh'), ...withSelf(balanceRow(r)) }))
    .filter((r) => r.day && r.kwh != null && r.day <= today)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);

  // Monthly balance for this year, and yearly since the plant started.
  const yearRows = (await optional('stationYear', () => call(cfg, '/v1/api/stationYear', { id, money: currency, year: today.slice(0, 4), timeZone: tz }))) ?? [];
  const months = (Array.isArray(yearRows) ? yearRows : [])
    .map((r) => clean({ month: String(r.dateStr ?? '').slice(0, 7), ...withSelf(balanceRow(r)) }))
    .filter((r) => r.month)
    .sort((a, b) => a.month.localeCompare(b.month));
  const allRows = (await optional('stationAll', () => call(cfg, '/v1/api/stationAll', { id, money: currency, timeZone: tz }))) ?? [];
  const years = (Array.isArray(allRows) ? allRows : [])
    .map((r) => clean({ year: String(r.year ?? r.dateStr ?? '').slice(0, 4), ...withSelf(balanceRow(r)) }))
    .filter((r) => r.year)
    .sort((a, b) => a.year.localeCompare(b.year));

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
  const powerKw = kw(d.power ?? station.power, d.powerStr ?? station.powerStr, 'kW');

  // Energy balance per period. Lifetime is the sum of the yearly rows (the meter's own lifetime
  // counters include energy from before the plant was installed).
  const periods = {
    day: withSelf({
      producedKwh: kwh(d.dayEnergy ?? station.dayEnergy, d.dayEnergyStr ?? station.dayEnergyStr, 'kWh'),
      consumedKwh: kwh(d.homeLoadTodayEnergy, d.homeLoadTodayEnergyStr, 'kWh'),
      importKwh: kwh(d.gridPurchasedDayEnergy ?? d.gridPurchasedTodayEnergy, d.gridPurchasedDayEnergyStr ?? d.gridPurchasedTodayEnergyStr, 'kWh'),
      exportKwh: kwh(d.gridSellDayEnergy ?? d.gridSellTodayEnergy, d.gridSellDayEnergyStr ?? d.gridSellTodayEnergyStr, 'kWh'),
      income: money(d.dayInCome ?? d.dayIncome, d.dayInComeUnit),
      fullHours: num(d.fullHour),
    }),
    month: withSelf({
      producedKwh: kwh(d.monthEnergy, d.monthEnergyStr, 'kWh'),
      consumedKwh: kwh(d.homeLoadMonthEnergy, d.homeLoadMonthEnergyStr, 'kWh'),
      importKwh: kwh(d.gridPurchasedMonthEnergy, d.gridPurchasedMonthEnergyStr, 'kWh'),
      exportKwh: kwh(d.gridSellMonthEnergy, d.gridSellMonthEnergyStr, 'kWh'),
      income: money(d.monthInCome ?? d.monthIncome, d.monthInComeUnit),
      fullHours: months.find((m) => m.month === thisMonth)?.fullHours,
    }),
    year: withSelf({
      producedKwh: kwh(d.yearEnergy, d.yearEnergyStr, 'kWh'),
      consumedKwh: kwh(d.homeLoadYearEnergy, d.homeLoadYearEnergyStr, 'MWh'),
      importKwh: kwh(d.gridPurchasedYearEnergy, d.gridPurchasedYearEnergyStr, 'kWh'),
      exportKwh: kwh(d.gridSellYearEnergy, d.gridSellYearEnergyStr, 'kWh'),
      income: money(d.yearInCome ?? d.yearIncome, d.yearInComeUnit),
      fullHours: Math.round(months.reduce((t, m) => t + (m.fullHours ?? 0), 0) * 100) / 100 || undefined,
    }),
    total: years.length
      ? withSelf({ ...sumRows(years), producedKwh: kwh(d.allEnergy ?? station.allEnergy, d.allEnergyStr ?? station.allEnergyStr, 'kWh'), income: num(d.allInCome1) ?? money(d.allInCome, d.allInComeUnit) })
      : { producedKwh: kwh(d.allEnergy ?? station.allEnergy, d.allEnergyStr ?? station.allEnergyStr, 'kWh'), income: num(d.allInCome1) ?? money(d.allInCome, d.allInComeUnit) },
  };

  const state = {
    statusLabel: label,
    solarStatus: group,
    powerKw,
    capacityKwp,
    todayKwh: periods.day.producedKwh,
    monthKwh: periods.month.producedKwh,
    yearKwh: periods.year.producedKwh,
    totalKwh: periods.total.producedKwh,
    income: { today: periods.day.income, month: periods.month.income, year: periods.year.income, total: periods.total.income, currency, pricePerKwh: num(d.price) },
    flow: {
      homeLoadKw: kw(d.familyLoadPower, d.familyLoadPowerStr, 'kW'),
      gridKw: kw(d.psum, d.psumStr, 'kW'), // + sending to the grid, − buying from it
      batteryKw: kw(d.batteryPower, d.batteryPowerStr, 'kW'),
      batteryPercent: num(d.batteryPercent),
    },
    todayGrid: { boughtKwh: periods.day.importKwh, soldKwh: periods.day.exportKwh, homeKwh: periods.day.consumedKwh },
    periods,
    peakSunHours: num(d.fullHour),
    weather: {
      day: d.condTxtD, night: d.condTxtN, minC: num(d.tmpMin), maxC: num(d.tmpMax),
      sunrise: d.sr, sunset: d.ss, humidity: num(d.hum), windMs: num(d.windSpd), windDir: d.windDir,
    },
    environment: { co2Kg: num(d.powerStationAvoidedCo2), coalKg: num(d.powerStationAvoidedTce), trees: num(d.powerStationNumTree) },
    plant: {
      place: [d.cityStr, d.regionStr, d.countryStr].filter(Boolean).join(', ') || undefined,
      tiltDeg: num(d.dip), azimuthDeg: num(d.azimuth), inverterKw: num(d.inverterPower),
      since: num(d.fisGenerateTime) ? new Date(Number(d.fisGenerateTime)).toISOString().slice(0, 10) : undefined,
      days: num(d.generateDays), alarms: num(d.alarmCount),
    },
    curve,
    days,
    months,
    years,
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
