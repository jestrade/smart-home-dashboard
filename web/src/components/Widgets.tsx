import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { CollapseButton, useCollapsed } from './Collapse';
import type { HomeLayout, WeatherLocation } from '../types';

// Home page widgets: clock, date, calendar and weather (Open-Meteo, no API key needed).

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};
const dayOfYear = (d: Date) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000);

/** 0 = Sunday … 6 = Saturday, from the browser's region (Intl.Locale weekInfo), defaulting to Monday. */
function firstDayOfWeek() {
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const fd = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    return fd ? fd % 7 : 1;
  } catch {
    return 1;
  }
}

/** Frame shared by all widgets: title row with a collapse chevron; a one-line summary when collapsed. */
function WidgetShell({ id, title, summary, className, children, actions }: {
  id: string; title: string; summary: string; className: string; children: ReactNode; actions?: ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(`widget:${id}`);
  const bodyId = useId();
  return (
    <section className={`card widget ${className} ${collapsed ? 'collapsed' : ''}`} aria-label={title}>
      <div className="widget-head">
        <span className="label">{title}</span>
        {collapsed && <span className="widget-summary">{summary}</span>}
        {!collapsed && actions}
        <CollapseButton collapsed={collapsed} onToggle={toggle} label={title} controls={bodyId} />
      </div>
      {!collapsed && <div id={bodyId} className="widget-body">{children}</div>}
    </section>
  );
}

function ClockWidget({ now }: { now: Date }) {
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <WidgetShell id="clock" title="Time" summary={time} className="clock">
      <div className="clock-time" aria-live="off">
        <span>{time}</span>
        <span className="clock-seconds">{seconds}</span>
      </div>
      <span className="fine">{tz.replace(/_/g, ' ')}</span>
    </WidgetShell>
  );
}

function DateWidget({ now }: { now: Date }) {
  return (
    <WidgetShell id="date" title="Date" className="date"
      summary={now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}>
      <span className="date-weekday">{now.toLocaleDateString(undefined, { weekday: 'long' })}</span>
      <div className="date-day">{now.getDate()}</div>
      <div className="date-month">{now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
      <span className="fine">Week {isoWeek(now)} · day {dayOfYear(now)} of the year</span>
    </WidgetShell>
  );
}

function CalendarWidget({ now }: { now: Date }) {
  const [offset, setOffset] = useState(0); // months from the current one
  const first = firstDayOfWeek();
  const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const lead = (view.getDay() - first + 7) % 7;
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }),
  );
  const isToday = (d: number | null) =>
    d != null && offset === 0 && d === now.getDate();

  return (
    <WidgetShell id="calendar" title="Calendar" className="calendar"
      summary={now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
      <div className="cal-head">
        <button className="btn ghost small" onClick={() => setOffset(offset - 1)} aria-label="Previous month">‹</button>
        <button className="cal-title" onClick={() => setOffset(0)} title="Back to this month">
          {view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </button>
        <button className="btn ghost small" onClick={() => setOffset(offset + 1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid" role="grid">
        {weekdays.map((w, i) => <span key={`h${i}`} className="cal-dow" role="columnheader">{w}</span>)}
        {cells.map((d, i) => (
          <span key={i} role="gridcell" className={`cal-day ${d == null ? 'empty' : ''} ${isToday(d) ? 'today' : ''}`}
            aria-current={isToday(d) ? 'date' : undefined}>
            {d ?? ''}
          </span>
        ))}
      </div>
    </WidgetShell>
  );
}

// ---------- weather ----------

const WMO: Record<number, [string, string]> = {
  0: ['Clear', 'sun'], 1: ['Mainly clear', 'partly'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'], 56: ['Freezing drizzle', 'rain'], 57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'], 66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Violent showers', 'rain'], 85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm, hail', 'storm'], 99: ['Thunderstorm, hail', 'storm'],
};
const wmo = (code: number, isDay = true): [string, string] => {
  const [label, icon] = WMO[code] ?? ['Unknown', 'cloud'];
  return [label, !isDay && icon === 'sun' ? 'moon' : icon];
};

interface Forecast {
  current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number; is_day: number };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; sunrise: string[]; sunset: string[] };
}

async function fetchForecast(loc: WeatherLocation, signal: AbortSignal): Promise<Forecast> {
  const q = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    forecast_days: '7',
    forecast_hours: '12',
    timezone: 'auto',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal });
  if (!r.ok) throw new Error(`Weather service error (${r.status})`);
  return r.json();
}

function LocationPicker({ onPick, onCancel }: { onPick: (l: WeatherLocation) => void; onCancel?: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(WeatherLocation & { detail: string })[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q.trim(), count: '6', language: navigator.language.slice(0, 2) })}`, { signal: ctrl.signal });
        const d = await r.json();
        setResults((d.results ?? []).map((x: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }) => ({
          name: x.name, lat: x.latitude, lon: x.longitude, detail: [x.admin1, x.country].filter(Boolean).join(', '),
        })));
        setError(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('Search failed. Try again.');
      }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const useMine = () =>
    navigator.geolocation.getCurrentPosition(
      (p) => onPick({ name: 'My location', lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
      () => setError('Location permission was denied. Search for a city instead.'),
    );

  return (
    <div className="loc-picker">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a city…" aria-label="Search a city" />
      <div className="btn-row tight">
        <button className="btn small" onClick={useMine}>Use my location</button>
        {onCancel && <button className="btn ghost small" onClick={onCancel}>Cancel</button>}
      </div>
      {error && <p className="error-text">{error}</p>}
      {results.length > 0 && (
        <ul className="loc-results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button onClick={() => onPick({ name: r.name, lat: r.lat, lon: r.lon })}>
                <b>{r.name}</b> <span className="fine">{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WeatherWidget({ location, onLocation }: { location?: WeatherLocation; onLocation: (l: WeatherLocation) => void }) {
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15 * 60 * 1000); // refresh every 15 minutes
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!location) return;
    const ctrl = new AbortController();
    fetchForecast(location, ctrl.signal).then(
      (d) => { setData(d); setError(null); },
      (e) => { if (e.name !== 'AbortError') setError(e.message); },
    );
    return () => ctrl.abort();
  }, [location?.lat, location?.lon, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = useMemo(() => {
    if (!data) return null;
    return { lo: Math.min(...data.daily.temperature_2m_min), hi: Math.max(...data.daily.temperature_2m_max) };
  }, [data]);

  const pick = (l: WeatherLocation) => { setPicking(false); setData(null); onLocation(l); };

  if (!location || picking) {
    return (
      <WidgetShell id="weather" title="Weather" summary="Choose a location" className="weather">
        <p className="fine">Choose the location for the forecast. It is saved for everyone in the household.</p>
        <LocationPicker onPick={pick} onCancel={location ? () => setPicking(false) : undefined} />
      </WidgetShell>
    );
  }

  const c = data?.current;
  const [label, icon] = c ? wmo(c.weather_code, c.is_day === 1) : ['', 'cloud'];
  const round = (v: number) => Math.round(v);
  const time = (iso: string) => iso.slice(11, 16);

  return (
    <WidgetShell id="weather" title={`Weather · ${location.name}`} className="weather"
      summary={c ? `${round(c.temperature_2m)}° ${label}` : 'Loading…'}
      actions={<button className="btn ghost small" onClick={() => setPicking(true)}>Change</button>}>
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <p className="fine">Loading forecast…</p>}
      {data && c && (
        <>
          <div className="weather-now">
            <span className="weather-icon"><Icon name={icon as 'sun'} size={44} /></span>
            <div>
              <div className="weather-temp">{round(c.temperature_2m)}°</div>
              <div>{label}</div>
            </div>
            <div className="kv weather-kv">
              <span>Feels like</span><b>{round(c.apparent_temperature)}°</b>
              <span>Humidity</span><b>{c.relative_humidity_2m}%</b>
              <span>Wind</span><b>{round(c.wind_speed_10m)} km/h</b>
              <span>Sun</span><b>{time(data.daily.sunrise[0])} – {time(data.daily.sunset[0])}</b>
            </div>
          </div>

          <div className="hourly" aria-label="Next 12 hours">
            {data.hourly.time.map((t, i) => (
              <div key={t} className="hour">
                <span className="fine">{time(t)}</span>
                <Icon name={wmo(data.hourly.weather_code[i])[1] as 'sun'} size={18} />
                <b>{round(data.hourly.temperature_2m[i])}°</b>
                {data.hourly.precipitation_probability[i] > 0 && <span className="rain-chance">{data.hourly.precipitation_probability[i]}%</span>}
              </div>
            ))}
          </div>

          <ul className="daily" aria-label="7-day forecast">
            {data.daily.time.map((d, i) => {
              const lo = data.daily.temperature_2m_min[i];
              const hi = data.daily.temperature_2m_max[i];
              const span = range ? range.hi - range.lo || 1 : 1;
              const left = range ? ((lo - range.lo) / span) * 100 : 0;
              const width = range ? ((hi - lo) / span) * 100 : 100;
              const [dl, di] = wmo(data.daily.weather_code[i]);
              return (
                <li key={d}>
                  <span className="day-name">{i === 0 ? 'Today' : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  <span title={dl}><Icon name={di as 'sun'} size={18} /></span>
                  <span className="rain-chance">{data.daily.precipitation_probability_max[i] ? `${data.daily.precipitation_probability_max[i]}%` : ''}</span>
                  <span className="t-lo">{round(lo)}°</span>
                  <span className="range" aria-hidden="true"><span style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }} /></span>
                  <span className="t-hi">{round(hi)}°</span>
                </li>
              );
            })}
          </ul>
          <p className="fine">Forecast: Open-Meteo.com</p>
        </>
      )}
    </WidgetShell>
  );
}

export function Widgets({ layout, onLayout }: { layout: HomeLayout; onLayout: (l: HomeLayout) => void }) {
  const now = useNow();
  const setWeather = (weather: WeatherLocation) => onLayout({ ...layout, widgets: { ...layout.widgets, weather } });
  const [collapsed, toggle] = useCollapsed('widgets');
  const gridId = useId();
  return (
    <section className="widgets-section">
      <h2 className="section-title widgets-title">
        <button type="button" className="section-toggle" onClick={toggle} aria-expanded={!collapsed} aria-controls={gridId}>
          <span>Today</span>
          {collapsed && (
            <span className="widget-summary">
              {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          )}
          <span className={`chevron ${collapsed ? '' : 'open'}`}><Icon name="chevron" size={16} /></span>
        </button>
      </h2>
      {!collapsed && (
        <div className="widgets" id={gridId}>
          <ClockWidget now={now} />
          <DateWidget now={now} />
          <CalendarWidget now={now} />
          <WeatherWidget location={layout.widgets?.weather} onLocation={setWeather} />
        </div>
      )}
    </section>
  );
}
