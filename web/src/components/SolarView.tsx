import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { CollapseButton, Section as CollapsibleSection, useCollapsed } from './Collapse';
import { displayName, type Device } from '../types';

// Read-only view of SolisCloud stations: live power, today's curve, last 30 days, inverters.

const n = (v?: number, digits = 1) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits }));
const energy = (kwh?: number) =>
  kwh == null ? '—' : kwh >= 1000 ? `${n(kwh / 1000, 2)} MWh` : `${n(kwh, 1)} kWh`;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  // Measure before paint so the chart never renders wider than its container.
  useLayoutEffect(() => {
    if (!ref.current) return;
    setWidth(Math.max(240, ref.current.clientWidth));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v)!;
}

const PAD = { l: 40, r: 12, t: 12, b: 24 };

/** Today's power: single-series area chart with a crosshair tooltip. */
function PowerCurve({ points }: { points: { t: string; kw: number }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 200;
  const w = width - PAD.l - PAD.r;
  const h = height - PAD.t - PAD.b;
  // x axis spans the day from 05:00 to 19:00 (or wider if data says so)
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const start = Math.min(300, ...points.map((p) => mins(p.t)));
  const end = Math.max(1140, ...points.map((p) => mins(p.t)));
  const yMax = niceMax(Math.max(...points.map((p) => p.kw), 0.1));
  const x = (t: string) => PAD.l + ((mins(t) - start) / (end - start)) * w;
  const y = (v: number) => PAD.t + h - (v / yMax) * h;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.kw).toFixed(1)}`).join('');
  const area = points.length ? `${line}L${x(points.at(-1)!.t).toFixed(1)},${y(0)}L${x(points[0].t).toFixed(1)},${y(0)}Z` : '';
  const ticks = [0, yMax / 2, yMax];
  const hours = [];
  for (let m = Math.ceil(start / 180) * 180; m <= end; m += 180) hours.push(m);
  const hp = hover != null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + PAD.l;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(points[best].t) - px)) best = i; });
    setHover(best);
  };

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={`Solar power today, peak ${n(Math.max(...points.map((p) => p.kw)))} kW`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{n(t)}</text>
          </g>
        ))}
        {hours.map((m) => (
          <text key={m} className="axis" x={PAD.l + ((m - start) / (end - start)) * w} y={height - 6} textAnchor="middle">
            {String(Math.floor(m / 60)).padStart(2, '0')}:00
          </text>
        ))}
        <path d={area} className="area" />
        <path d={line} className="line" />
        {hp && (
          <g>
            <line className="crosshair" x1={x(hp.t)} x2={x(hp.t)} y1={PAD.t} y2={PAD.t + h} />
            <circle className="dot" cx={x(hp.t)} cy={y(hp.kw)} r={5} />
          </g>
        )}
        <rect x={PAD.l} y={PAD.t} width={w} height={h} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: Math.min(x(hp.t), width - 110), top: Math.max(0, y(hp.kw) - 52) }}>
          <b>{n(hp.kw, 2)} kW</b><span>{hp.t}</span>
        </div>
      )}
      <span className="axis-unit">kW</span>
    </div>
  );
}

/** Daily energy: single-series bar chart with per-bar hover. */
function DailyBars({ days }: { days: { day: string; kwh: number }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 180;
  const w = width - PAD.l - PAD.r;
  const h = height - PAD.t - PAD.b;
  const yMax = niceMax(Math.max(...days.map((d) => d.kwh), 0.1));
  const slot = w / Math.max(days.length, 1);
  const barW = Math.max(2, slot - 2); // 2px gap between bars
  const y = (v: number) => PAD.t + h - (v / yMax) * h;
  const r = Math.min(4, barW / 2);
  const bar = (x0: number, top: number, bottom: number) =>
    bottom - top < r
      ? `M${x0},${bottom}V${top}H${x0 + barW}V${bottom}Z`
      : `M${x0},${bottom}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${bottom}Z`;
  const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const hd = hover != null ? days[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={`Daily solar energy, last ${days.length} days`}>
        {[0, yMax / 2, yMax].map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{n(t, 0)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x0 = PAD.l + i * slot + 1;
          return (
            <g key={d.day}>
              <path d={bar(x0, y(d.kwh), y(0))} className={`bar ${hover === i ? 'hover' : ''}`} />
              {(i % 7 === 0 || i === days.length - 1) && (
                <text className="axis" x={x0 + barW / 2} y={height - 6} textAnchor="middle">{fmtDay(d.day)}</text>
              )}
              <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={h} fill="transparent"
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      {hd && hover != null && (
        <div className="tooltip" style={{ left: Math.min(PAD.l + hover * slot, width - 120), top: Math.max(0, y(hd.kwh) - 52) }}>
          <b>{n(hd.kwh, 1)} kWh</b><span>{fmtDay(hd.day)}</span>
        </div>
      )}
      <span className="axis-unit">kWh</span>
    </div>
  );
}

const Section = (p: { title: string; id?: string; children: ReactNode }) => <CollapsibleSection scope="solar" {...p} />;

export function SolarView({ stations, onConnect }: { stations: Device[]; onConnect: () => void }) {
  if (stations.length === 0) {
    return (
      <div className="empty">
        <Icon name="sun" size={40} />
        <p>No solar stations yet.</p>
        <button className="btn primary" onClick={onConnect}>Connect SolisCloud</button>
      </div>
    );
  }
  return <div className="stack">{stations.map((s) => <StationCard key={s.id} station={s} />)}</div>;
}

function StationCard({ station }: { station: Device }) {
  const [collapsed, toggleCollapsed] = useCollapsed(`solar:${station.id}`);
  const s = station.state;
  const f = s.flow ?? {};
  const g = s.todayGrid ?? {};
  const inc = s.income ?? {};
  const pct = s.powerKw != null && s.capacityKwp ? Math.round((s.powerKw / s.capacityKwp) * 100) : null;
  const tone = s.solarStatus === 'ok' ? 'ok' : s.solarStatus === 'alarm' ? 'warn' : 'muted';
  const money = (v?: number) => (v == null ? '—' : `${v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 })} ${inc.currency ?? ''}`.trim());
  const sumDays = (s.days ?? []).reduce((t, d) => t + d.kwh, 0);

  return (
    <article className="card vehicle">
      <header className="vehicle-head">
        <div>
          <h2>{displayName(station)}</h2>
          <div className="device-sub">
            <span className={`badge ${tone}`}>{s.statusLabel ?? 'Unknown'}</span>
            {s.capacityKwp != null && <span className="badge muted">{n(s.capacityKwp, 2)} kWp</span>}
          </div>
          {s.reportedAt && <p className="fine">Reported {new Date(s.reportedAt).toLocaleString()}</p>}
        </div>
        <span className={`charger-icon ${s.powerKw ? 'sun-live' : ''}`}><Icon name="sun" size={52} /></span>
        <CollapseButton collapsed={collapsed} onToggle={toggleCollapsed} label={displayName(station)} />
      </header>
      {!collapsed && (<>

      <div className="stats">
        <div className="stat">
          <span className="label">Producing now</span>
          <span className="big">{n(s.powerKw, 2)}<small> kW</small></span>
          {pct != null && <><span className="meter"><span className="meter-chart" style={{ width: `${Math.min(100, pct)}%` }} /></span><span className="fine">{pct}% of capacity</span></>}
        </div>
        <div className="stat"><span className="label">Today</span><span className="big">{n(s.todayKwh)}<small> kWh</small></span>{inc.today != null && <span className="fine">≈ {money(inc.today)}</span>}</div>
        <div className="stat"><span className="label">This month</span><span className="big" style={{ fontSize: 22 }}>{energy(s.monthKwh)}</span></div>
        <div className="stat"><span className="label">This year</span><span className="big" style={{ fontSize: 22 }}>{energy(s.yearKwh)}</span></div>
        <div className="stat"><span className="label">Lifetime</span><span className="big" style={{ fontSize: 22 }}>{energy(s.totalKwh)}</span></div>
      </div>

      {(f.homeLoadKw != null || f.gridKw != null || f.batteryPercent != null || g.boughtKwh != null) && (
        <Section title="Energy flow">
          <div className="kv">
            {f.homeLoadKw != null && <><span>Home using now</span><b>{n(f.homeLoadKw, 2)} kW</b></>}
            {f.gridKw != null && <><span>Grid power now</span><b>{n(Math.abs(f.gridKw), 2)} kW</b></>}
            {f.batteryPercent != null && <><span>Battery</span><b>{f.batteryPercent}%{f.batteryKw != null ? ` · ${n(f.batteryKw, 2)} kW` : ''}</b></>}
            {g.homeKwh != null && <><span>Home used today</span><b>{n(g.homeKwh)} kWh</b></>}
            {g.boughtKwh != null && <><span>Bought from grid today</span><b>{n(g.boughtKwh)} kWh</b></>}
            {g.soldKwh != null && <><span>Sent to grid today</span><b>{n(g.soldKwh)} kWh</b></>}
            {s.peakSunHours != null && <><span>Peak sun hours today</span><b>{n(s.peakSunHours)} h</b></>}
          </div>
        </Section>
      )}

      {s.curve && s.curve.length > 1 && (
        <Section title="Power today">
          <PowerCurve points={s.curve} />
          <details className="data-table">
            <summary>Show data</summary>
            <div className="table-wrap"><table className="sessions"><thead><tr><th>Time</th><th>kW</th></tr></thead>
              <tbody>{s.curve.map((p) => <tr key={p.t}><td>{p.t}</td><td>{n(p.kw, 2)}</td></tr>)}</tbody></table></div>
          </details>
        </Section>
      )}

      {s.days && s.days.length > 0 && (
        <Section id="daily" title={`Daily energy · last ${s.days.length} days · ${energy(sumDays)}`}>
          <DailyBars days={s.days} />
          <details className="data-table">
            <summary>Show data</summary>
            <div className="table-wrap"><table className="sessions"><thead><tr><th>Day</th><th>kWh</th></tr></thead>
              <tbody>{[...s.days].reverse().map((d) => <tr key={d.day}><td>{d.day}</td><td>{n(d.kwh)}</td></tr>)}</tbody></table></div>
          </details>
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
