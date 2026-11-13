import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { niceMax, useWidth } from './chartUtils';
import { displayName, type Device } from '../types';

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
  estimated?: boolean;
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

function measuredLoads(devices: Device[]): Load[] {
  const loads: Omit<Load, 'slot'>[] = [];
  for (const d of devices) {
    if (d.stale || d.prefs?.hidden) continue;
    if (d.type === 'charger') {
      loads.push({ id: d.id, name: displayName(d), nowKw: d.state.statusGroup === 'charging' ? d.state.chargingPowerKw ?? 0 : 0, days: chargerDays(d) });
    } else if (d.type !== 'vehicle' && d.type !== 'solar' && (d.state.powerW != null || d.state.energyDays?.length)) {
      loads.push({
        id: d.id, name: displayName(d), nowKw: d.state.powerW != null ? d.state.powerW / 1000 : undefined,
        days: new Map((d.state.energyDays ?? []).map((x) => [x.day, x.kwh])), estimated: d.state.energyEstimated,
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

/** Horizontal bar split into parts, with a legend underneath. */
function Breakdown({ parts, unit }: { parts: { label: string; value: number; color: string; note?: string }[]; unit: (v: number) => string }) {
  const sum = parts.reduce((t, p) => t + p.value, 0);
  if (!sum) return <p className="fine">Nothing measured yet.</p>;
  return (
    <div className="breakdown">
      <div className="split-bar" role="img" aria-label={parts.map((p) => `${p.label} ${unit(p.value)}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => <span key={p.label} style={{ width: `${(p.value / sum) * 100}%`, background: p.color }} />)}
      </div>
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

const PAD = { l: 44, r: 12, t: 12, b: 24 };

/** Daily use, stacked by device, with the house total as the full height of each bar. */
function DailyStack({ days, series }: { days: string[]; series: { label: string; color: string; values: number[] }[] }) {
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
        <svg width={width} height={height} role="img" aria-label="Daily electricity use by device">
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
              <g key={d} opacity={hover == null || hover === i ? 1 : 0.55}>
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
                <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={h} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <div className="tooltip" style={{ left: Math.min(PAD.l + hover * slot + slot, width - 200), top: PAD.t }}>
            <span>{fmt(days[hover], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <b>House {kwh(totals[hover])}</b>
            {series.filter((s) => s.values[hover] > 0).map((s) => <span key={s.label}>{s.label} {kwh(s.values[hover])}</span>)}
          </div>
        )}
        <span className="axis-unit">kWh</span>
      </div>
    </>
  );
}

export function EnergyView({ devices, onConnect }: { devices: Device[]; onConnect: () => void }) {
  const station = devices.find((d) => d.type === 'solar' && !d.stale);
  const loads = useMemo(() => measuredLoads(devices), [devices]);
  const unmetered = devices.filter((d) => !d.stale && !d.prefs?.hidden && !['vehicle', 'solar', 'camera'].includes(d.type) && !loads.some((l) => l.id === d.id));

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
  const today = localDay(Date.now());
  const day = s.periods?.day ?? {};
  const houseNow = s.flow?.homeLoadKw;
  const grid = s.flow?.gridKw;

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
  const measuredToday = sumDay(loads, today);
  const houseToday = day.consumedKwh;
  const restToday = houseToday != null ? Math.max(0, houseToday - measuredToday) : undefined;

  // Last 30 days, from the plant's daily house use when there is one, else from the devices.
  const houseDays = new Map((s.days ?? []).map((d) => [d.day, d.consumedKwh]));
  const dayKeys = (houseDays.size ? [...houseDays.keys()] : [...new Set(loads.flatMap((l) => [...l.days.keys()]))]).sort().slice(-MAX_DAYS);
  const series = [
    ...groups.map((g) => ({ label: g.label, color: g.color, values: dayKeys.map((d) => sumDay(g.loads, d)) })),
    ...(houseDays.size ? [{ label: 'Rest of the house', color: restColor, values: dayKeys.map((d) => Math.max(0, (houseDays.get(d) ?? 0) - sumDay(loads, d))) }] : []),
  ];
  const monthTotal = (ls: Load[]) => dayKeys.reduce((t, d) => t + sumDay(ls, d), 0);
  const houseMonth = dayKeys.reduce((t, d) => t + (houseDays.get(d) ?? 0), 0);

  return (
    <div className="stack">
      <article className="card energy">
        <h2>Energy</h2>
        <p className="fine">The house total comes from the solar plant's meter; the car charger and the devices that measure their own use are shown apart. Everything else is the rest of the house.</p>

        <div className="stats energy-now">
          <div className="stat"><span className="label">Home using now</span><span className="big">{kw(houseNow)}</span></div>
          <div className="stat"><span className="label">Solar now</span><span className="big">{kw(s.powerKw)}</span></div>
          <div className="stat"><span className="label">Grid now</span><span className="big">{kw(grid == null ? undefined : Math.abs(grid))}</span>
            {grid != null && <span className={`badge ${grid < -0.01 ? 'info' : grid > 0.01 ? 'ok' : 'muted'}`}>{grid < -0.01 ? 'Importing' : grid > 0.01 ? 'Exporting' : 'Idle'}</span>}</div>
          <div className="stat"><span className="label">Used today</span><span className="big">{kwh(houseToday)}</span>
            {money(houseToday != null && price != null ? houseToday * price : undefined) && <span className="fine">≈ {money(houseToday! * price!)}</span>}</div>
          <div className="stat"><span className="label">Made today</span><span className="big">{kwh(day.producedKwh)}</span></div>
          <div className="stat"><span className="label">Bought · sold today</span><span className="big">{kwh(day.importKwh)}</span><span className="fine">sold {kwh(day.exportKwh)}</span></div>
        </div>
      </article>

      <article className="card energy">
        <h3>Where the power goes now</h3>
        <Breakdown unit={kw} parts={[
          ...groups.map((g) => ({ label: g.label, value: sumNow(g.loads), color: g.color })),
          ...(restNow != null ? [{ label: 'Rest of the house', value: restNow, color: restColor, note: '(not measured)' }] : []),
        ]} />
      </article>

      <article className="card energy">
        <h3>Today</h3>
        <Breakdown unit={kwh} parts={[
          ...groups.map((g) => ({ label: g.label, value: sumDay(g.loads, today), color: g.color, note: g.loads.some((l) => l.estimated) ? '(estimated)' : undefined })),
          ...(restToday != null ? [{ label: 'Rest of the house', value: restToday, color: restColor, note: '(not measured)' }] : []),
        ]} />
        {(day.selfKwh != null || day.importKwh != null) && houseToday ? (
          <p className="fine">The home's energy today came {Math.round(((day.selfKwh ?? 0) / houseToday) * 100)}% from the sun and {Math.round(((houseToday - (day.selfKwh ?? 0)) / houseToday) * 100)}% from the grid.</p>
        ) : null}
      </article>

      {dayKeys.length > 1 && (
        <article className="card energy">
          <h3>Last {dayKeys.length} days</h3>
          <DailyStack days={dayKeys} series={series} />
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
        {loads.length === 0 ? <p className="fine">None yet.</p> : (
          <div className="table-wrap"><table className="sessions">
            <thead><tr><th>Device</th><th>Now</th><th>Today</th><th>Last {dayKeys.length} days</th>{houseMonth > 0 && <th>Share of house</th>}{price != null && <th>Cost, {dayKeys.length} days</th>}</tr></thead>
            <tbody>
              {loads.map((l) => {
                const m = monthTotal([l]);
                return (
                  <tr key={l.id}>
                    <td><i className="swatch" style={{ background: color(l.slot) }} />{l.name}{l.estimated && <em className="fine"> estimated</em>}</td>
                    <td>{kw(l.nowKw)}</td>
                    <td>{kwh(l.days.get(today) ?? 0)}</td>
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
