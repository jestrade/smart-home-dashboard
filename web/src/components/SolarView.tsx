import { useState, type ReactNode } from 'react';
import { niceMax, useWidth } from './chartUtils';
import { Icon } from './Icon';
import { CollapseButton, Section as CollapsibleSection, useCollapsed } from './Collapse';
import { displayName, type Device, type DeviceState, type EnergyBalance } from '../types';

// Read-only view of solar stations: power flow now, energy balance per period, today's power,
// history, weather, plant details and inverters.

const n = (v?: number, digits = 1) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits }));
const energy = (kwh?: number) =>
  kwh == null ? '—' : kwh >= 1000 ? `${n(kwh / 1000, 2)} MWh` : `${n(kwh, 1)} kWh`;

const PAD = { l: 44, r: 12, t: 12, b: 24 };

type Money = (v?: number) => string;
const pct = (part?: number, whole?: number) => (part == null || !whole ? null : Math.round((part / whole) * 100));

// ---------- power right now ----------

function FlowNow({ s }: { s: DeviceState }) {
  const f = s.flow ?? {};
  const grid = f.gridKw;
  const selling = grid != null && grid > 0.01;
  const buying = grid != null && grid < -0.01;
  const battery = f.batteryPercent != null && (f.batteryPercent > 0 || Math.abs(f.batteryKw ?? 0) > 0);
  return (
    <div className="flow-now" aria-label="Power right now">
      <div className="flow-node solar">
        <span className="flow-dot" /><span className="label">Solar</span>
        <b>{n(s.powerKw, 2)} kW</b>
      </div>
      <span className={`flow-arrow ${(s.powerKw ?? 0) > 0.01 ? 'on' : ''}`} aria-hidden="true">→</span>
      <div className="flow-node home">
        <span className="flow-dot" /><span className="label">Home</span>
        <b>{n(f.homeLoadKw, 2)} kW</b>
        {f.homeLoadKw != null && (s.powerKw ?? 0) > 0 && (
          <span className="fine">{Math.min(100, pct(Math.min(s.powerKw ?? 0, f.homeLoadKw), f.homeLoadKw) ?? 0)}% solar</span>
        )}
      </div>
      <span className={`flow-arrow ${buying ? 'on rev' : selling ? 'on' : ''}`} aria-hidden="true">{buying ? '←' : '→'}</span>
      <div className="flow-node grid">
        <span className="flow-dot" /><span className="label">Grid</span>
        <b>{n(grid == null ? undefined : Math.abs(grid), 2)} kW</b>
        <span className={`badge ${buying ? 'info' : selling ? 'ok' : 'muted'}`}>{buying ? 'Buying' : selling ? 'Selling' : 'Idle'}</span>
      </div>
      {battery && (
        <div className="flow-node battery">
          <span className="label">Battery</span>
          <b>{f.batteryPercent}%</b>
          <span className="fine">{n(f.batteryKw, 2)} kW</span>
        </div>
      )}
    </div>
  );
}

// ---------- energy balance for a period ----------

const PERIODS = [['day', 'Today'], ['month', 'Month'], ['year', 'Year'], ['total', 'Lifetime']] as const;
type PeriodId = (typeof PERIODS)[number][0];

/** A bar split in two, with each part labelled underneath. */
function Split({ title, total, a, b }: {
  title: string; total?: number;
  a: { label: string; kwh?: number; cls: string }; b: { label: string; kwh?: number; cls: string };
}) {
  const sum = (a.kwh ?? 0) + (b.kwh ?? 0);
  const pa = sum ? ((a.kwh ?? 0) / sum) * 100 : 0;
  return (
    <div className="split">
      <div className="split-head"><span className="label">{title}</span><b>{energy(total)}</b></div>
      <div className="split-bar" role="img" aria-label={`${a.label} ${energy(a.kwh)}, ${b.label} ${energy(b.kwh)}`}>
        {pa > 0 && <span className={a.cls} style={{ width: `${pa}%` }} />}
        {pa < 100 && sum > 0 && <span className={b.cls} style={{ width: `${100 - pa}%` }} />}
      </div>
      <div className="split-legend">
        <span><i className={a.cls} />{a.label} <b>{energy(a.kwh)}</b> · {sum ? Math.round(pa) : 0}%</span>
        <span><i className={b.cls} />{b.label} <b>{energy(b.kwh)}</b> · {sum ? 100 - Math.round(pa) : 0}%</span>
      </div>
    </div>
  );
}

function Balance({ s, money }: { s: DeviceState; money: Money }) {
  const [period, setPeriod] = useState<PeriodId>('day');
  const p: EnergyBalance = s.periods?.[period] ?? {};
  const fromGrid = p.consumedKwh != null && p.selfKwh != null ? Math.max(0, p.consumedKwh - p.selfKwh) : p.importKwh;
  const price = s.income?.pricePerKwh;
  const days = s.days ?? [];
  const yesterday = period === 'day' && days.length > 1 ? days[days.length - 2].producedKwh ?? days[days.length - 2].kwh : undefined;
  const change = yesterday && p.producedKwh != null ? ((p.producedKwh - yesterday) / yesterday) * 100 : null;
  const net = p.importKwh != null && p.exportKwh != null ? p.importKwh - p.exportKwh : undefined;
  return (
    <div className="balance">
      <div className="seg" role="tablist" aria-label="Period">
        {PERIODS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={period === id} className={period === id ? 'on' : ''} onClick={() => setPeriod(id)}>{label}</button>
        ))}
      </div>
      <div className="splits">
        <Split title="Solar energy made" total={p.producedKwh}
          a={{ label: 'Used at home', kwh: p.selfKwh, cls: 's-home' }} b={{ label: 'Sold to grid', kwh: p.exportKwh, cls: 's-grid' }} />
        <Split title="Energy the home used" total={p.consumedKwh}
          a={{ label: 'From solar', kwh: p.selfKwh, cls: 's-solar' }} b={{ label: 'From grid', kwh: fromGrid, cls: 's-grid' }} />
      </div>
      <div className="stats balance-stats">
        <div className="stat"><span className="label">Generation</span><span className="big">{energy(p.producedKwh)}</span>
          {change != null && <span className="fine">{change >= 0 ? '▲' : '▼'} {n(Math.abs(change))}% vs yesterday</span>}</div>
        <div className="stat"><span className="label">Consumption</span><span className="big">{energy(p.consumedKwh)}</span></div>
        <div className="stat"><span className="label">Bought from grid</span><span className="big">{energy(p.importKwh)}</span>
          {price != null && p.importKwh != null && <span className="fine">≈ {money(p.importKwh * price)}</span>}</div>
        <div className="stat"><span className="label">Sold to grid</span><span className="big">{energy(p.exportKwh)}</span>
          {price != null && p.exportKwh != null && <span className="fine">≈ {money(p.exportKwh * price)}</span>}</div>
        <div className="stat"><span className="label">Earning</span><span className="big">{money(p.income)}</span>
          {price != null && p.selfKwh != null && <span className="fine">{money(p.selfKwh * price)} saved · {money((p.exportKwh ?? 0) * price)} sold</span>}</div>
        <div className="stat"><span className="label">Self-sufficiency</span><span className="big">{pct(p.selfKwh, p.consumedKwh) ?? '—'}<small>%</small></span>
          <span className="fine">of the home's energy came from the sun</span></div>
        {net != null && <div className="stat"><span className="label">Net from grid</span><span className="big">{energy(net)}</span><span className="fine">bought − sold</span></div>}
        {p.fullHours != null && <div className="stat"><span className="label">Full-load hours</span><span className="big">{n(p.fullHours)}<small> h</small></span></div>}
      </div>
    </div>
  );
}

// ---------- today's power: solar, home and grid ----------

const SERIES = [
  { key: 'kw', label: 'Solar', cls: 's-solar' },
  { key: 'homeKw', label: 'Home', cls: 's-home' },
  { key: 'gridKw', label: 'Grid (+ sold, − bought)', cls: 's-grid' },
] as const;

function Legend({ items }: { items: readonly { label: string; cls: string }[] }) {
  return <div className="legend">{items.map((i) => <span key={i.label}><i className={i.cls} />{i.label}</span>)}</div>;
}

export function PowerToday({ points }: { points: NonNullable<DeviceState['curve']> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 220;
  const w = width - PAD.l - PAD.r;
  const h = height - PAD.t - PAD.b;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const start = Math.min(0, ...points.map((p) => mins(p.t)));
  const end = Math.max(1440, ...points.map((p) => mins(p.t)));
  const values = points.flatMap((p) => [p.kw, p.homeKw ?? 0, p.gridKw ?? 0]);
  const yMax = niceMax(Math.max(...values, 0.1));
  const yMin = Math.min(...values) < 0 ? -niceMax(-Math.min(...values)) : 0;
  const x = (t: string) => PAD.l + ((mins(t) - start) / (end - start)) * w;
  const y = (v: number) => PAD.t + h - ((v - yMin) / (yMax - yMin)) * h;
  const path = (get: (p: (typeof points)[number]) => number | undefined) =>
    points.filter((p) => get(p) != null).map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(get(p)!).toFixed(1)}`).join('');
  const solarLine = path((p) => p.kw);
  const area = points.length ? `${solarLine}L${x(points.at(-1)!.t).toFixed(1)},${y(0)}L${x(points[0].t).toFixed(1)},${y(0)}Z` : '';
  const ticks = yMin < 0 ? [yMin, 0, yMax] : [0, yMax / 2, yMax];
  const hours = [];
  for (let m = Math.ceil(start / 180) * 180; m <= end; m += 180) hours.push(m);
  const hp = hover != null ? points[hover] : null;
  const shown = SERIES.filter((sr) => points.some((p) => p[sr.key] != null));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + PAD.l;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(points[best].t) - px)) best = i; });
    setHover(best);
  };

  return (
    <>
      <Legend items={shown} />
      <div className="chart" ref={ref}>
        <svg width={width} height={height} role="img" aria-label={`Power today: solar peak ${n(Math.max(...points.map((p) => p.kw)))} kW`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={`grid ${t === 0 ? 'zero' : ''}`} x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{n(t)}</text>
            </g>
          ))}
          {hours.map((m) => (
            <text key={m} className="axis" x={PAD.l + ((m - start) / (end - start)) * w} y={height - 6} textAnchor="middle">
              {String(Math.floor(m / 60) % 24).padStart(2, '0')}:00
            </text>
          ))}
          <path d={area} className="area s-solar" />
          {shown.map((sr) => <path key={sr.key} d={path((p) => p[sr.key])} className={`line ${sr.cls}`} />)}
          {hp && (
            <g>
              <line className="crosshair" x1={x(hp.t)} x2={x(hp.t)} y1={PAD.t} y2={PAD.t + h} />
              {shown.map((sr) => hp[sr.key] != null && <circle key={sr.key} className={`dot ${sr.cls}`} cx={x(hp.t)} cy={y(hp[sr.key]!)} r={4} />)}
            </g>
          )}
          <rect x={PAD.l} y={PAD.t} width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {hp && (
          <div className="tooltip" style={{ left: Math.min(x(hp.t) + 8, width - 170), top: PAD.t }}>
            <span>{hp.t}</span>
            <b>Solar {n(hp.kw, 2)} kW</b>
            {hp.homeKw != null && <span>Home {n(hp.homeKw, 2)} kW</span>}
            {hp.gridKw != null && <span>Grid {hp.gridKw >= 0 ? 'selling' : 'buying'} {n(Math.abs(hp.gridKw), 2)} kW</span>}
          </div>
        )}
        <span className="axis-unit">kW</span>
      </div>
    </>
  );
}

// ---------- history: days, months, years ----------

type Row = EnergyBalance & { key: string; label: string; long: string };

function HistoryBars({ rows, money }: { rows: Row[]; money: Money }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 200;
  const w = width - PAD.l - PAD.r;
  const h = height - PAD.t - PAD.b;
  const yMax = niceMax(Math.max(...rows.flatMap((r) => [r.producedKwh ?? 0, r.consumedKwh ?? 0]), 0.1));
  const slot = w / Math.max(rows.length, 1);
  const barW = Math.max(1.5, (slot - 4) / 2); // two bars per slot, 2px apart, 2px between slots
  const y = (v: number) => PAD.t + h - (v / yMax) * h;
  const bar = (x0: number, v: number) => {
    const top = y(v);
    const bottom = y(0);
    const r = Math.min(4, barW / 2, bottom - top);
    return `M${x0},${bottom}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${bottom}Z`;
  };
  const every = Math.ceil(rows.length / Math.max(1, Math.floor(w / 56)));
  const hr = hover != null ? rows[hover] : null;
  return (
    <>
      <Legend items={[{ label: 'Generation', cls: 's-solar' }, { label: 'Consumption', cls: 's-home' }]} />
      <div className="chart" ref={ref}>
        <svg width={width} height={height} role="img" aria-label="Generation and consumption history">
          {[0, yMax / 2, yMax].map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{n(t, 0)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x0 = PAD.l + i * slot + 1;
            return (
              <g key={r.key} className={hover === i ? 'hover' : ''}>
                {(r.producedKwh ?? 0) > 0 && <path d={bar(x0, r.producedKwh!)} className="bar s-solar" />}
                {(r.consumedKwh ?? 0) > 0 && <path d={bar(x0 + barW + 2, r.consumedKwh!)} className="bar s-home" />}
                {(i % every === 0 || i === rows.length - 1) && (
                  <text className="axis" x={x0 + barW} y={height - 6} textAnchor="middle">{r.label}</text>
                )}
                <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={h} fill="transparent"
                  onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
        {hr && hover != null && (
          <div className="tooltip" style={{ left: Math.min(PAD.l + hover * slot + slot, width - 190), top: PAD.t }}>
            <span>{hr.long}</span>
            <b>Made {energy(hr.producedKwh)} · used {energy(hr.consumedKwh)}</b>
            <span>Bought {energy(hr.importKwh)} · sold {energy(hr.exportKwh)}</span>
            <span>Earning {money(hr.income)}</span>
          </div>
        )}
        <span className="axis-unit">kWh</span>
      </div>
    </>
  );
}

function History({ s, money }: { s: DeviceState; money: Money }) {
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const date = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, o);
  const sets: Record<typeof mode, Row[]> = {
    days: (s.days ?? []).map((d) => ({ ...d, producedKwh: d.producedKwh ?? d.kwh, key: d.day, label: date(d.day, { month: 'short', day: 'numeric' }), long: date(d.day, { weekday: 'short', month: 'short', day: 'numeric' }) })),
    months: (s.months ?? []).map((m) => ({ ...m, key: m.month, label: date(`${m.month}-15`, { month: 'short' }), long: date(`${m.month}-15`, { month: 'long', year: 'numeric' }) })),
    years: (s.years ?? []).map((y) => ({ ...y, key: y.year, label: y.year, long: y.year })),
  };
  const rows = sets[mode];
  const total = (k: keyof EnergyBalance) => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
  return (
    <>
      <div className="seg" role="tablist" aria-label="History range">
        {([['days', 'Last 30 days'], ['months', 'This year'], ['years', 'By year']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>{label}</button>
        ))}
      </div>
      {rows.length === 0 ? <p className="fine">No data for this range yet.</p> : (
        <>
          <p className="fine history-sum">
            Made {energy(total('producedKwh'))} · used {energy(total('consumedKwh'))} · bought {energy(total('importKwh'))} · sold {energy(total('exportKwh'))} · earning {money(total('income'))}
          </p>
          <HistoryBars rows={rows} money={money} />
          <details className="data-table">
            <summary>Show data</summary>
            <div className="table-wrap"><table className="sessions">
              <thead><tr><th>{mode === 'days' ? 'Day' : mode === 'months' ? 'Month' : 'Year'}</th><th>Made</th><th>Used</th><th>From solar</th><th>Bought</th><th>Sold</th><th>Earning</th></tr></thead>
              <tbody>{[...rows].reverse().map((r) => (
                <tr key={r.key}><td>{r.long}</td><td>{energy(r.producedKwh)}</td><td>{energy(r.consumedKwh)}</td><td>{pct(r.selfKwh, r.consumedKwh) ?? '—'}%</td>
                  <td>{energy(r.importKwh)}</td><td>{energy(r.exportKwh)}</td><td>{money(r.income)}</td></tr>
              ))}</tbody>
            </table></div>
          </details>
        </>
      )}
    </>
  );
}

const Section = (p: { title: string; id?: string; children: ReactNode }) => <CollapsibleSection scope="solar" {...p} />;

export function SolarView({ stations, onConnect }: { stations: Device[]; onConnect: () => void }) {
  if (stations.length === 0) {
    return (
      <div className="empty">
        <Icon name="sun" size={40} />
        <p>No solar stations yet.</p>
        <button className="btn primary" onClick={onConnect}>Connect a solar system</button>
      </div>
    );
  }
  return <div className="stack">{stations.map((s) => <StationCard key={s.id} station={s} />)}</div>;
}

function StationCard({ station }: { station: Device }) {
  const [collapsed, toggleCollapsed] = useCollapsed(`solar:${station.id}`);
  const s = station.state;
  const inc = s.income ?? {};
  const load = s.powerKw != null && s.capacityKwp ? Math.round((s.powerKw / s.capacityKwp) * 100) : null;
  const tone = s.solarStatus === 'ok' ? 'ok' : s.solarStatus === 'alarm' ? 'warn' : 'muted';
  const money: Money = (v) => {
    if (v == null) return '—';
    try {
      const big = Math.abs(v) >= 1e6; // millions read better short: COP 16.5M
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: inc.currency ?? 'USD', notation: big ? 'compact' : 'standard', maximumFractionDigits: big ? 1 : v >= 100 ? 0 : 2,
      }).format(v);
    } catch {
      return `${n(v, 0)} ${inc.currency ?? ''}`.trim();
    }
  };
  const w = s.weather ?? {};
  const env = s.environment ?? {};
  const pl = s.plant ?? {};

  return (
    <article className="card vehicle">
      <header className="vehicle-head">
        <div>
          <h2>{displayName(station)}</h2>
          <div className="device-sub">
            <span className={`badge ${tone}`}>{s.statusLabel ?? 'Unknown'}</span>
            {s.capacityKwp != null && <span className="badge muted">{n(s.capacityKwp, 2)} kWp</span>}
            {load != null && <span className="badge muted">{load}% of capacity</span>}
          </div>
          {s.reportedAt && <p className="fine">Reported {new Date(s.reportedAt).toLocaleString()}</p>}
        </div>
        <span className={`charger-icon ${s.powerKw ? 'sun-live' : ''}`}><Icon name="sun" size={52} /></span>
        <CollapseButton collapsed={collapsed} onToggle={toggleCollapsed} label={displayName(station)} />
      </header>
      {!collapsed && (<>

      <FlowNow s={s} />

      <div className="stats earnings">
        <div className="stat"><span className="label">Earning today</span><span className="big">{money(inc.today)}</span></div>
        <div className="stat"><span className="label">This month</span><span className="big">{money(inc.month)}</span></div>
        <div className="stat"><span className="label">This year</span><span className="big">{money(inc.year)}</span></div>
        <div className="stat"><span className="label">Lifetime</span><span className="big">{money(inc.total)}</span>
          {inc.pricePerKwh != null && <span className="fine">at {money(inc.pricePerKwh)} per kWh</span>}</div>
      </div>

      {s.periods && (
        <Section id="balance" title="Generation vs consumption">
          <Balance s={s} money={money} />
        </Section>
      )}

      {s.curve && s.curve.length > 1 && (
        <Section title="Power today">
          <PowerToday points={s.curve} />
          <details className="data-table">
            <summary>Show data</summary>
            <div className="table-wrap"><table className="sessions"><thead><tr><th>Time</th><th>Solar kW</th><th>Home kW</th><th>Grid kW</th></tr></thead>
              <tbody>{s.curve.map((p) => <tr key={p.t}><td>{p.t}</td><td>{n(p.kw, 2)}</td><td>{n(p.homeKw, 2)}</td><td>{n(p.gridKw, 2)}</td></tr>)}</tbody></table></div>
          </details>
        </Section>
      )}

      {(s.days?.length || s.months?.length || s.years?.length) ? (
        <Section id="daily" title="History">
          <History s={s} money={money} />
        </Section>
      ) : null}

      {(s.weather || s.environment || s.plant) && (
        <Section id="plant" title="Weather, impact and plant">
          <div className="solar-details">
            {s.weather && (
              <div className="kv">
                <span>Today</span><b>{w.day ?? '—'}{w.night ? ` · night ${w.night}` : ''}</b>
                {w.minC != null && <><span>Temperature</span><b>{w.minC}–{w.maxC} °C</b></>}
                {w.sunrise && <><span>Sunrise / sunset</span><b>{w.sunrise} / {w.sunset}</b></>}
                {w.humidity != null && <><span>Humidity</span><b>{n(w.humidity, 0)}%</b></>}
                {w.windMs != null && <><span>Wind</span><b>{w.windDir ?? ''} {n(w.windMs)} m/s</b></>}
                {s.peakSunHours != null && <><span>Full-load hours today</span><b>{n(s.peakSunHours)} h</b></>}
              </div>
            )}
            {s.environment && (
              <div className="kv">
                {env.co2Kg != null && <><span>CO₂ avoided</span><b>{env.co2Kg >= 1000 ? `${n(env.co2Kg / 1000)} t` : `${n(env.co2Kg, 0)} kg`}</b></>}
                {env.coalKg != null && <><span>Coal saved</span><b>{env.coalKg >= 1000 ? `${n(env.coalKg / 1000)} t` : `${n(env.coalKg, 0)} kg`}</b></>}
                {env.trees != null && <><span>Equivalent trees planted</span><b>{n(env.trees)}</b></>}
                {s.totalKwh != null && <><span>Energy made, lifetime</span><b>{energy(s.totalKwh)}</b></>}
              </div>
            )}
            {s.plant && (
              <div className="kv">
                {pl.place && <><span>Location</span><b>{pl.place}</b></>}
                {s.capacityKwp != null && <><span>Panels</span><b>{n(s.capacityKwp, 2)} kWp{pl.inverterKw ? ` · ${n(pl.inverterKw)} kW inverter` : ''}</b></>}
                {pl.tiltDeg != null && <><span>Tilt / orientation</span><b>{n(pl.tiltDeg, 0)}° / {n(pl.azimuthDeg, 0)}°</b></>}
                {pl.since && <><span>Producing since</span><b>{new Date(`${pl.since}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })}</b></>}
                {pl.days != null && <><span>Days producing</span><b>{n(pl.days, 0)}</b></>}
                {pl.alarms != null && <><span>Active alarms</span><b>{pl.alarms}</b></>}
              </div>
            )}
          </div>
        </Section>
      )}

      {s.inverters && s.inverters.length > 0 && (
        <Section title="Inverters">
          <div className="table-wrap">
            <table className="sessions">
              <thead><tr><th>Serial</th><th>Model</th><th>Status</th><th>Now</th><th>Today</th><th>Lifetime</th></tr></thead>
              <tbody>
                {s.inverters.map((i) => (
                  <tr key={i.sn}><td>{i.sn}</td><td>{i.model ?? '—'}</td><td>{i.state}</td><td>{n(i.kw, 2)} kW</td><td>{n(i.todayKwh)} kWh</td><td>{energy(i.totalKwh)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      </>)}
    </article>
  );
}
