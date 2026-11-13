import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { niceMax, useWidth } from './chartUtils';
import { PowerToday } from './SolarView';
import { backend } from '../data';
import { displayName, type Device, type DeviceState, type EnergyBalance } from '../types';

// Where the home's electricity goes: the house total from the solar plant's meter, split by the
// devices that measure their own use (the car charger, metering plugs, Samsung appliances).
// Whatever is not measured shows as "Rest of the house".

const n = (v?: number, digits = 1) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits }));
const kwh = (v?: number) => (v == null ? '—' : `${n(v, v < 10 ? 2 : 1)} kWh`);
const kw = (v?: number) => (v == null ? '—' : v < 1 ? `${n(v * 1000, 0)} W` : `${n(v, 2)} kW`);
const localDay = (t: number) => new Date(t).toLocaleDateString('en-CA'); // yyyy-mm-dd, this browser's time zone

const SLOTS = 6; // categorical colours; more devices fold into "Other measured"
const MAX_DAYS = 30;

interface Load {
  id: string;
  name: string;
  /** Power now, kW. */
  nowKw?: number;
  /** kWh per day. */
  days: Map<string, number>;
  /** kWh per local hour, "yyyy-mm-ddTHH". */
  hours: Map<string, number>;
  estimated?: boolean;
  /** Its records cover every day (a day without an entry used nothing), as with charger sessions. */
  complete?: boolean;
  slot: number; // 1..SLOTS, or 0 for "Other measured"
}

/** The car charger's energy per day, from its sessions (counted on the day they started). */
function chargerDays(c: Device) {
  const days = new Map<string, number>();
  for (const s of c.state.sessions ?? []) {
    if (!s.energyKwh) continue;
    const day = localDay(s.start * 1000);
    days.set(day, (days.get(day) ?? 0) + s.energyKwh);
  }
  const live = c.state.session;
  if (live && !live.finished && live.energyKwh) {
    const today = localDay(Date.now());
    days.set(today, (days.get(today) ?? 0) + live.energyKwh);
  }
  return days;
}

const hourKey = (t: number) => `${localDay(t)}T${String(new Date(t).getHours()).padStart(2, '0')}`;

/** The charger's energy per hour, each session spread evenly over the time it ran. */
function chargerHours(c: Device) {
  const hours = new Map<string, number>();
  const spread = (start: number, end: number, kwh: number) => {
    if (!(end > start)) { hours.set(hourKey(start), (hours.get(hourKey(start)) ?? 0) + kwh); return; }
    for (let t = start; t < end;) {
      const next = Math.min(end, new Date(t).setMinutes(60, 0, 0));
      hours.set(hourKey(t), (hours.get(hourKey(t)) ?? 0) + (kwh * (next - t)) / (end - start));
      t = next;
    }
  };
  for (const s of c.state.sessions ?? []) {
    if (!s.energyKwh) continue;
    spread(s.start * 1000, s.end ? s.end * 1000 : s.start * 1000 + (s.durationS ?? 0) * 1000, s.energyKwh);
  }
  const live = c.state.session;
  if (live && !live.finished && live.energyKwh) spread(Date.now() - (live.durationS ?? 0) * 1000, Date.now(), live.energyKwh);
  return hours;
}

function measuredLoads(devices: Device[]): Load[] {
  const loads: Omit<Load, 'slot'>[] = [];
  for (const d of devices) {
    if (d.stale || d.prefs?.hidden) continue;
    if (d.type === 'charger') {
      loads.push({ id: d.id, name: displayName(d), nowKw: d.state.statusGroup === 'charging' ? d.state.chargingPowerKw ?? 0 : 0, days: chargerDays(d), hours: chargerHours(d), complete: true });
    } else if (d.type !== 'vehicle' && d.type !== 'solar' && (d.state.powerW != null || d.state.energyDays?.length)) {
      loads.push({
        id: d.id, name: displayName(d), nowKw: d.state.powerW != null ? d.state.powerW / 1000 : undefined,
        days: new Map((d.state.energyDays ?? []).map((x) => [x.day, x.kwh])), hours: new Map((d.state.energyHours ?? []).map((x) => [x.h, x.kwh])), estimated: d.state.energyEstimated,
      });
    }
  }
  // Biggest users get their own colour, in a fixed order; the rest share one.
  const total = (l: Omit<Load, 'slot'>) => [...l.days.values()].reduce((t, v) => t + v, 0) + (l.nowKw ?? 0);
  return loads
    .sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name))
    .map((l, i) => ({ ...l, slot: i < SLOTS - 1 ? i + 1 : 0 }));
}

const color = (slot: number) => (slot ? `var(--e${slot})` : 'var(--e-other)');

type Part = { label: string; value: number; color: string; note?: string };

/** A ring split into parts (2px surface gap between slices), the total in the middle. */
function Donut({ parts, unit, label, size = 168 }: { parts: Part[]; unit: (v: number) => string; label: string; size?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const sum = parts.reduce((t, p) => t + p.value, 0);
  const stroke = 22;
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const shown = parts.filter((p) => p.value > 0);
  const gap = shown.length > 1 ? 2 : 0;
  let acc = 0;
  const hp = shown.find((p) => p.label === hover);
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={`${label}: ${shown.map((p) => `${p.label} ${unit(p.value)}`).join(', ')}`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="donut-track" strokeWidth={stroke} />
      {shown.map((p) => {
        const len = (p.value / sum) * c;
        const el = (
          <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color}
            strokeWidth={hover === p.label ? stroke + 6 : stroke}
            strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`} strokeDashoffset={-acc}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} opacity={hover && hover !== p.label ? 0.45 : 1}
            onPointerEnter={() => setHover(p.label)} onPointerLeave={() => setHover(null)}>
            <title>{`${p.label}: ${unit(p.value)} (${Math.round((p.value / sum) * 100)}%)`}</title>
          </circle>
        );
        acc += len;
        return el;
      })}
      <text x={size / 2} y={size / 2 - 4} textAnchor="middle" className="donut-value">{hp ? `${Math.round((hp.value / sum) * 100)}%` : unit(sum)}</text>
      <text x={size / 2} y={size / 2 + 16} textAnchor="middle" className="donut-label">{hp ? hp.label.slice(0, 18) : label}</text>
    </svg>
  );
}

/** Donut beside its legend: name, value and share for every part. */
function Breakdown({ parts, unit, label }: { parts: Part[]; unit: (v: number) => string; label: string }) {
  const sum = parts.reduce((t, p) => t + p.value, 0);
  if (!sum) return <p className="fine">Nothing measured yet.</p>;
  return (
    <div className="breakdown">
      <Donut parts={parts} unit={unit} label={label} />
      <ul className="breakdown-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: p.color }} />
            <span className="breakdown-name">{p.label}{p.note && <em> {p.note}</em>}</span>
            <b>{unit(p.value)}</b>
            <span className="fine">{Math.round((p.value / sum) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One horizontal bar per device, longest first, on a shared scale. */
function Ranking({ rows, unit }: { rows: Part[]; unit: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!max) return <p className="fine">Nothing measured yet.</p>;
  return (
    <ul className="ranking">
      {rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value).map((r) => (
        <li key={r.label} title={`${r.label}: ${unit(r.value)}`}>
          <span className="breakdown-name">{r.label}{r.note && <em> {r.note}</em>}</span>
          <span className="ranking-track"><span style={{ width: `${(r.value / max) * 100}%`, background: r.color }} /></span>
          <b>{unit(r.value)}</b>
        </li>
      ))}
    </ul>
  );
}

const PAD = { l: 44, r: 12, t: 12, b: 24 };

/** Daily use, stacked by device, with the house total as the full height of each bar. */
function DailyStack({ days, series, label = 'Daily electricity use by device', selected, onPick }: {
  days: string[]; series: { label: string; color: string; values: number[] }[]; label?: string; selected?: string; onPick?: (day: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 220;
  const w = width - PAD.l - PAD.r;
  const h = height - PAD.t - PAD.b;
  const totals = days.map((_, i) => series.reduce((t, s) => t + s.values[i], 0));
  const yMax = niceMax(Math.max(...totals, 0.1));
  const slot = w / Math.max(days.length, 1);
  const barW = Math.max(2, slot - 2);
  const y = (v: number) => PAD.t + h - (v / yMax) * h;
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, o);
  const every = Math.ceil(days.length / Math.max(1, Math.floor(w / 56)));
  return (
    <>
      <div className="legend">{series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</div>
      <div className="chart" ref={ref}>
        <svg width={width} height={height} role="img" aria-label={label}>
          {[0, yMax / 2, yMax].map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{n(t, 0)}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const x0 = PAD.l + i * slot + 1;
            let acc = 0;
            return (
              <g key={d} opacity={hover === i || d === selected || (hover == null && !days.includes(selected ?? '')) ? 1 : 0.55}>
                {series.map((s) => {
                  const v = s.values[i];
                  if (v <= 0) return null;
                  const top = y(acc + v);
                  const bottom = y(acc);
                  acc += v;
                  // 2px surface gap between stacked parts
                  return <rect key={s.label} x={x0} y={top + 1} width={barW} height={Math.max(0, bottom - top - 2)} rx={acc === totals[i] ? 3 : 0} style={{ fill: s.color }} />;
                })}
                {(i % every === 0 || i === days.length - 1) && (
                  <text className="axis" x={x0 + barW / 2} y={height - 6} textAnchor="middle">{fmt(d, { month: 'short', day: 'numeric' })}</text>
                )}
                <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={h} fill="transparent" style={onPick ? { cursor: 'pointer' } : undefined}
                  onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={() => onPick?.(d)} />
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <div className="tooltip" style={{ left: Math.min(PAD.l + hover * slot + slot, width - 200), top: PAD.t }}>
            <span>{fmt(days[hover], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <b>Total {kwh(totals[hover])}</b>
            {series.filter((s) => s.values[hover] > 0).map((s) => <span key={s.label}>{s.label} {kwh(s.values[hover])}</span>)}
          </div>
        )}
        <span className="axis-unit">kWh</span>
      </div>
    </>
  );
}

type Curve = NonNullable<DeviceState['curve']>;
interface HourRow { solar: number; home: number; bought: number; sold: number }

/** kWh per hour from readings every few minutes (each reading lasts until the next, at most 30 min). */
function hourlyFromCurve(curve: Curve): HourRow[] | null {
  if (curve.length < 2) return null;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const pts = [...curve].sort((a, b) => mins(a.t) - mins(b.t));
  const rows = Array.from({ length: 24 }, () => ({ solar: 0, home: 0, bought: 0, sold: 0 }));
  pts.forEach((p, i) => {
    const m = mins(p.t);
    const dt = Math.min((i + 1 < pts.length ? mins(pts[i + 1].t) : m + 15) - m, 30) / 60;
    const r = rows[Math.min(23, Math.floor(m / 60))];
    r.solar += p.kw * dt;
    r.home += (p.homeKw ?? 0) * dt;
    if ((p.gridKw ?? 0) > 0) r.sold += p.gridKw! * dt;
    else r.bought += -(p.gridKw ?? 0) * dt;
  });
  return rows;
}

const shiftDay = (d: string, by: number) => {
  const t = new Date(`${d}T12:00:00`);
  t.setDate(t.getDate() + by);
  return localDay(t.getTime());
};
const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const OLDEST_DAYS = 730;

type Remote = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; curve: Curve; balance: EnergyBalance | null; found: boolean };

export function EnergyView({ devices, onConnect }: { devices: Device[]; onConnect: () => void }) {
  const station = devices.find((d) => d.type === 'solar' && !d.stale);
  const loads = useMemo(() => measuredLoads(devices), [devices]);
  const unmetered = devices.filter((d) => !d.stale && !d.prefs?.hidden && !['vehicle', 'solar', 'camera'].includes(d.type) && !loads.some((l) => l.id === d.id));
  const today = localDay(Date.now());
  const [date, setDate] = useState(today);
  const [remote, setRemote] = useState<Remote>({ status: 'idle' });
  const isToday = date === today;
  const stationId = station?.id;

  useEffect(() => {
    if (isToday || !stationId) { setRemote({ status: 'idle' }); return; }
    let live = true;
    setRemote({ status: 'loading' });
    backend.energyDay(date).then(
      (r) => {
        if (!live) return;
        const st = r.stations.find((x) => x.deviceId === stationId) ?? r.stations[0];
        setRemote({ status: 'ok', curve: st?.curve ?? [], balance: st?.balance ?? null, found: Boolean(st && (st.curve.length || st.balance)) });
      },
      (e: Error) => live && setRemote({ status: 'error', message: e.message }),
    );
    return () => { live = false; };
  }, [date, isToday, stationId]);

  if (!station && loads.length === 0) {
    return (
      <div className="empty">
        <Icon name="plug" size={40} />
        <p>No energy data yet. Connect your solar plant, car charger or metering plugs.</p>
        <button className="btn primary" onClick={onConnect}>Go to integrations</button>
      </div>
    );
  }

  const s = station?.state ?? {};
  const price = s.income?.pricePerKwh;
  const money = (v?: number) => {
    if (v == null || price == null) return null;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: s.income?.currency ?? 'USD', maximumFractionDigits: 0 }).format(v);
    } catch {
      return `${n(v, 0)} ${s.income?.currency ?? ''}`;
    }
  };
  const houseNow = s.flow?.homeLoadKw;
  const grid = s.flow?.gridKw;

  // The chosen day's balance and power curve: live for today, fetched for other days.
  const fromDays = s.days?.find((x) => x.day === date);
  const day: EnergyBalance = isToday ? s.periods?.day ?? {} : (remote.status === 'ok' && remote.balance) || fromDays || {};
  const curve: Curve = isToday ? s.curve ?? [] : remote.status === 'ok' ? remote.curve : [];
  const hourly = hourlyFromCurve(curve);

  // Colour per load (fixed order), and the folded "Other measured" group.
  const named = loads.filter((l) => l.slot);
  const folded = loads.filter((l) => !l.slot);
  const groups = [
    ...named.map((l) => ({ label: l.name, color: color(l.slot), loads: [l] })),
    ...(folded.length ? [{ label: `Other measured (${folded.length})`, color: color(0), loads: folded }] : []),
  ];
  const sumNow = (ls: Load[]) => ls.reduce((t, l) => t + (l.nowKw ?? 0), 0);
  const sumDay = (ls: Load[], d: string) => ls.reduce((t, l) => t + (l.days.get(d) ?? 0), 0);
  const restColor = 'var(--e-rest)';

  const measuredNow = sumNow(loads);
  const restNow = houseNow != null ? Math.max(0, houseNow - measuredNow) : undefined;
  const houseDay = day.consumedKwh;
  const restDay = houseDay != null ? Math.max(0, houseDay - sumDay(loads, date)) : undefined;

  // What the chosen day has, and what it lacks.
  const withDay = loads.filter((l) => l.complete || l.days.has(date));
  const withoutDay = loads.filter((l) => !l.complete && !l.days.has(date));
  const since = (l: Load) => [...l.days.keys()].sort()[0];
  const hourLoads = loads.filter((l) => [...l.hours.keys()].some((k) => k.startsWith(date)) || (l.complete && l.days.has(date)));
  const dailyOnly = withDay.filter((l) => !hourLoads.includes(l) && (l.days.get(date) ?? 0) > 0);
  const hourOf = (l: Load, h: number) => l.hours.get(`${date}T${String(h).padStart(2, '0')}`) ?? 0;
  const currentHour = new Date().getHours();
  const hourShown = (h: number) => !isToday || h <= currentHour;

  // Last 30 days, from the plant's daily house use when there is one, else from the devices.
  const houseDays = new Map((s.days ?? []).map((d) => [d.day, d.consumedKwh]));
  const dayKeys = (houseDays.size ? [...houseDays.keys()] : [...new Set(loads.flatMap((l) => [...l.days.keys()]))]).sort().slice(-MAX_DAYS);
  const series = [
    ...groups.map((g) => ({ label: g.label, color: g.color, values: dayKeys.map((d) => sumDay(g.loads, d)) })),
    ...(houseDays.size ? [{ label: 'Rest of the house', color: restColor, values: dayKeys.map((d) => Math.max(0, (houseDays.get(d) ?? 0) - sumDay(loads, d))) }] : []),
  ];
  const balanceDays = new Map((s.days ?? []).map((d) => [d.day, d]));
  const sourceSeries = balanceDays.size && dayKeys.some((d) => balanceDays.get(d)?.selfKwh != null) ? [
    { label: 'Sun', color: 'var(--s-solar)', values: dayKeys.map((d) => balanceDays.get(d)?.selfKwh ?? 0) },
    { label: 'Grid', color: 'var(--s-grid)', values: dayKeys.map((d) => balanceDays.get(d)?.importKwh ?? 0) },
  ] : null;
  const monthTotal = (ls: Load[]) => dayKeys.reduce((t, d) => t + sumDay(ls, d), 0);
  const houseMonth = dayKeys.reduce((t, d) => t + (houseDays.get(d) ?? 0), 0);
  const oldest = shiftDay(today, -OLDEST_DAYS);
  const pick = (d: string) => setDate(d > today ? today : d < oldest ? oldest : d);

  const dayBreakdown = (
    <article className="card energy">
      <h3>{isToday ? 'Today' : `Used on ${shortDay(date)}`}</h3>
      <Breakdown unit={kwh} label={isToday ? 'used today' : 'used'} parts={[
        ...groups.map((g) => ({ label: g.label, value: sumDay(g.loads, date), color: g.color, note: g.loads.some((l) => l.estimated) ? '(estimated)' : undefined })),
        ...(restDay != null ? [{ label: 'Rest of the house', value: restDay, color: restColor, note: '(not measured)' }] : []),
      ]} />
      {(day.selfKwh != null || day.importKwh != null) && houseDay ? (
        <p className="fine">The home's energy came {Math.round(((day.selfKwh ?? 0) / houseDay) * 100)}% from the sun and {Math.round(((houseDay - (day.selfKwh ?? 0)) / houseDay) * 100)}% from the grid.</p>
      ) : null}
    </article>
  );

  return (
    <div className="stack">
      <article className="card energy">
        <div className="energy-head">
          <h2>Energy</h2>
          <div className="date-bar" role="group" aria-label="Day to show">
            <button type="button" className="btn icon-btn" aria-label="Previous day" disabled={date <= oldest} onClick={() => pick(shiftDay(date, -1))}>‹</button>
            <input type="date" value={date} min={oldest} max={today} aria-label="Date" onChange={(e) => e.target.value && pick(e.target.value)} />
            <button type="button" className="btn icon-btn" aria-label="Next day" disabled={isToday} onClick={() => pick(shiftDay(date, 1))}>›</button>
            {!isToday && <button type="button" className="btn" onClick={() => setDate(today)}>Today</button>}
          </div>
        </div>
        <p className="fine">The house total comes from the solar plant's meter; the car charger and the devices that measure their own use are shown apart. Everything else is the rest of the house.</p>

        {!isToday && remote.status === 'loading' && <p className="fine">Loading {longDay(date)} from the solar plant…</p>}
        {!isToday && remote.status === 'error' && <p className="warning">Could not load {longDay(date)} from the solar plant: {remote.message}</p>}
        {!isToday && remote.status === 'ok' && !remote.found && !fromDays && <p className="warning">The solar plant has no record for {longDay(date)}.</p>}
        {withoutDay.length > 0 && (
          <p className="warning">
            ⚠ No record for {isToday ? 'today' : longDay(date)} from {withoutDay.map((l) => `${l.name}${since(l) ? ` (records since ${shortDay(since(l))})` : ''}`).join(', ')}.
            {' '}These devices only keep their use from the day they were first synced.
          </p>
        )}
        {unmetered.length > 0 && !isToday && (
          <p className="warning">⚠ {unmetered.length} devices do not report their use on any day, so they can't be filtered by date: they are part of "Rest of the house".</p>
        )}

        {isToday ? (
          <div className="stats energy-now">
            <div className="stat"><span className="label">Home using now</span><span className="big">{kw(houseNow)}</span></div>
            <div className="stat"><span className="label">Solar now</span><span className="big">{kw(s.powerKw)}</span></div>
            <div className="stat"><span className="label">Grid now</span><span className="big">{kw(grid == null ? undefined : Math.abs(grid))}</span>
              {grid != null && <span className={`badge ${grid < -0.01 ? 'info' : grid > 0.01 ? 'ok' : 'muted'}`}>{grid < -0.01 ? 'Importing' : grid > 0.01 ? 'Exporting' : 'Idle'}</span>}</div>
            <div className="stat"><span className="label">Used today</span><span className="big">{kwh(houseDay)}</span>
              {houseDay != null && money(houseDay * (price ?? 0)) && <span className="fine">≈ {money(houseDay * price!)}</span>}</div>
            <div className="stat"><span className="label">Made today</span><span className="big">{kwh(day.producedKwh)}</span></div>
            <div className="stat"><span className="label">Bought · sold today</span><span className="big">{kwh(day.importKwh)}</span><span className="fine">sold {kwh(day.exportKwh)}</span></div>
          </div>
        ) : (
          <div className="stats energy-now">
            <div className="stat"><span className="label">Used</span><span className="big">{kwh(houseDay)}</span>
              {houseDay != null && money(houseDay * (price ?? 0)) && <span className="fine">≈ {money(houseDay * price!)}</span>}</div>
            <div className="stat"><span className="label">Made</span><span className="big">{kwh(day.producedKwh)}</span></div>
            <div className="stat"><span className="label">Bought</span><span className="big">{kwh(day.importKwh)}</span></div>
            <div className="stat"><span className="label">Sold</span><span className="big">{kwh(day.exportKwh)}</span></div>
            <div className="stat"><span className="label">From the sun</span><span className="big">{houseDay && day.selfKwh != null ? `${Math.round((day.selfKwh / houseDay) * 100)}%` : '—'}</span></div>
          </div>
        )}
      </article>

      {curve.length > 1 && (
        <article className="card energy">
          <h3>Power through the day{isToday ? '' : ` · ${shortDay(date)}`}</h3>
          <PowerToday points={curve} />
        </article>
      )}

      {isToday ? (
        <div className="energy-pair">
          <article className="card energy">
            <h3>Where the power goes now</h3>
            <Breakdown unit={kw} label="using now" parts={[
              ...groups.map((g) => ({ label: g.label, value: sumNow(g.loads), color: g.color })),
              ...(restNow != null ? [{ label: 'Rest of the house', value: restNow, color: restColor, note: '(not measured)' }] : []),
            ]} />
          </article>
          {dayBreakdown}
        </div>
      ) : dayBreakdown}

      {houseDay ? (
        <article className="card energy">
          <h3>Sun and grid{isToday ? ' today' : ` · ${shortDay(date)}`}</h3>
          <div className="donut-pair">
            <div>
              <h4>Where the home's energy came from</h4>
              <Breakdown unit={kwh} label="used" parts={[
                { label: 'Sun', value: day.selfKwh ?? 0, color: 'var(--s-solar)' },
                { label: 'Grid', value: day.importKwh ?? Math.max(0, houseDay - (day.selfKwh ?? 0)), color: 'var(--s-grid)' },
              ]} />
            </div>
            {day.producedKwh ? (
              <div>
                <h4>What the panels' energy did</h4>
                <Breakdown unit={kwh} label="made" parts={[
                  { label: 'Used at home', value: day.selfKwh ?? 0, color: 'var(--s-home)' },
                  { label: 'Sold to the grid', value: day.exportKwh ?? 0, color: 'var(--s-grid)' },
                ]} />
              </div>
            ) : null}
          </div>
        </article>
      ) : null}

      {(hourly || hourLoads.length > 0) && (
        <article className="card energy">
          <h3>Hour by hour{isToday ? ' · today' : ` · ${shortDay(date)}`}</h3>
          <div className="table-wrap"><table className="sessions hour-table">
            <thead><tr>
              <th>Hour</th>
              {hourly && <><th><i className="swatch" style={{ background: 'var(--s-home)' }} />House</th><th><i className="swatch" style={{ background: 'var(--s-solar)' }} />Solar</th><th>Bought</th><th>Sold</th></>}
              {hourLoads.map((l) => <th key={l.id}><i className="swatch" style={{ background: color(l.slot) }} />{l.name}</th>)}
            </tr></thead>
            <tbody>
              {Array.from({ length: 24 }, (_, h) => h).filter(hourShown).map((h) => {
                const r = hourly?.[h];
                const peak = hourly ? Math.max(...hourly.map((x) => x.home)) : 0;
                return (
                  <tr key={h} className={isToday && h === currentHour ? 'now' : undefined}>
                    <td>{String(h).padStart(2, '0')}:00</td>
                    {r && <>
                      <td className="bar-cell"><span style={{ width: `${peak ? (r.home / peak) * 100 : 0}%` }} /><b>{kwh(r.home)}</b></td>
                      <td>{kwh(r.solar)}</td><td>{kwh(r.bought)}</td><td>{kwh(r.sold)}</td>
                    </>}
                    {hourLoads.map((l) => <td key={l.id}>{kwh(hourOf(l, h))}</td>)}
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr>
              <th>Total</th>
              {hourly && <><th>{kwh(hourly.reduce((t, r) => t + r.home, 0))}</th><th>{kwh(hourly.reduce((t, r) => t + r.solar, 0))}</th><th>{kwh(hourly.reduce((t, r) => t + r.bought, 0))}</th><th>{kwh(hourly.reduce((t, r) => t + r.sold, 0))}</th></>}
              {hourLoads.map((l) => <th key={l.id}>{kwh(Array.from({ length: 24 }, (_, h) => hourOf(l, h)).reduce((a, b) => a + b, 0))}</th>)}
            </tr></tfoot>
          </table></div>
          <p className="fine">
            House, solar and grid come from the plant's readings every 15 minutes, so the totals can differ slightly from the plant's daily figures.
            {hourLoads.some((l) => l.complete) && ' Car charging is spread evenly over each session.'}
          </p>
          {dailyOnly.length > 0 && (
            <p className="warning">⚠ {dailyOnly.map((l) => l.name).join(', ')} only {dailyOnly.length === 1 ? 'has' : 'have'} a daily total for this day ({dailyOnly.map((l) => kwh(l.days.get(date))).join(', ')}). Devices are recorded hour by hour since this update, and only the last 7 days are kept.</p>
          )}
        </article>
      )}

      {dayKeys.length > 1 && (
        <article className="card energy">
          <h3>Last {dayKeys.length} days</h3>
          <p className="fine">Tap a day to see it above.</p>
          <h4>By device</h4>
          <DailyStack days={dayKeys} series={series} selected={isToday ? undefined : date} onPick={pick} />
          {sourceSeries && (
            <>
              <h4>Sun or grid</h4>
              <DailyStack days={dayKeys} series={sourceSeries} label="Daily house use, from the sun or the grid" selected={isToday ? undefined : date} onPick={pick} />
            </>
          )}
          <details className="data-table">
            <summary>Show data</summary>
            <div className="table-wrap"><table className="sessions">
              <thead><tr><th>Day</th>{houseDays.size > 0 && <th>House</th>}{series.map((x) => <th key={x.label}>{x.label}</th>)}</tr></thead>
              <tbody>{[...dayKeys].reverse().map((d) => {
                const i = dayKeys.indexOf(d);
                return <tr key={d}><td>{d}</td>{houseDays.size > 0 && <td>{kwh(houseDays.get(d))}</td>}{series.map((x) => <td key={x.label}>{kwh(x.values[i])}</td>)}</tr>;
              })}</tbody>
            </table></div>
          </details>
        </article>
      )}

      <article className="card energy">
        <h3>Devices that measure their use</h3>
        {loads.length > 0 && (
          <>
            <h4>Last {dayKeys.length} days</h4>
            <Ranking unit={kwh} rows={loads.map((l) => ({ label: l.name, value: monthTotal([l]), color: color(l.slot), note: l.estimated ? '(estimated)' : undefined }))} />
          </>
        )}
        {loads.length === 0 ? <p className="fine">None yet.</p> : (
          <div className="table-wrap"><table className="sessions">
            <thead><tr><th>Device</th><th>Now</th><th>{isToday ? 'Today' : shortDay(date)}</th><th>Last {dayKeys.length} days</th>{houseMonth > 0 && <th>Share of house</th>}{price != null && <th>Cost, {dayKeys.length} days</th>}</tr></thead>
            <tbody>
              {loads.map((l) => {
                const m = monthTotal([l]);
                return (
                  <tr key={l.id}>
                    <td><i className="swatch" style={{ background: color(l.slot) }} />{l.name}{l.estimated && <em className="fine"> estimated</em>}</td>
                    <td>{kw(l.nowKw)}</td>
                    <td>{l.complete || l.days.has(date) ? kwh(l.days.get(date) ?? 0) : '—'}</td>
                    <td>{kwh(m)}</td>
                    {houseMonth > 0 && <td>{Math.round((m / houseMonth) * 100)}%</td>}
                    {price != null && <td>{money(m * price)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        <p className="fine">
          Daily figures for plugs and appliances start counting from the day they were first synced.
          {loads.some((l) => l.estimated) && ' "Estimated" devices only report power, so their energy is worked out from the readings every 15 minutes.'}
        </p>
        {unmetered.length > 0 && (
          <details className="data-table">
            <summary>{unmetered.length} devices do not report their use</summary>
            <p className="fine">{unmetered.map((d) => displayName(d)).join(' · ')}</p>
          </details>
        )}
      </article>
    </div>
  );
}
