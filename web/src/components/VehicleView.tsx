import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { CollapseButton, Section as CollapsibleSection, useCollapsed } from './Collapse';
import { displayName, type Device } from '../types';
import { profileFor, type CarProfile } from '../carProfiles';

// Read-only view of everything Volvo reports about each car.

const num = (n?: number, digits = 0) =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** frontLeftDoor -> Front left door, TOO_LOW -> Too low */
const words = (s: string) =>
  s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const OK_VALUES = new Set(['NO_WARNING', 'CLOSED', 'LOCKED', 'UNSPECIFIED', 'NO_FAILURE', 'NORMAL', 'OK']);
const statusText = (v?: string) => (v == null ? '—' : v === 'NO_WARNING' ? 'OK' : words(v));
const tone = (v?: string) => (v == null ? 'muted' : OK_VALUES.has(v) ? 'ok' : 'warn');

const UNAVAILABLE_LABELS: Record<string, string> = {
  details: 'model, colour and photo (needs conve:vehicle_relation)',
  diagnostics: 'service interval and washer fluid (needs conve:diagnostics_workshop)',
  location: 'location',
  fuel: 'fuel level',
  energy: 'battery and charging',
  statistics: 'trip statistics',
  windows: 'windows',
  tyres: 'tyres',
  warnings: 'bulb warnings',
  brakes: 'brake fluid',
  engine: 'oil and coolant',
};

function ago(iso?: string) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(mins)) return null;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}

export function VehicleView({ vehicles, onConnect }: { vehicles: Device[]; onConnect: () => void }) {
  if (vehicles.length === 0) {
    return (
      <div className="empty">
        <Icon name="vehicle" size={40} />
        <p>No vehicles yet.</p>
        <button className="btn primary" onClick={onConnect}>Connect Volvo</button>
      </div>
    );
  }
  return <div className="stack">{vehicles.map((v) => <VehicleCard key={v.id} car={v} />)}</div>;
}

const Section = (p: { title: string; id?: string; children: ReactNode }) => <CollapsibleSection scope="car" {...p} />;

function Stat({ label, value, unit, children }: { label: string; value: ReactNode; unit?: string; children?: ReactNode }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="big">{value}{unit && <small> {unit}</small>}</span>
      {children}
    </div>
  );
}

function StatusList({ items }: { items: [string, string | undefined][] }) {
  return (
    <ul className="status-list">
      {items.map(([label, v]) => (
        <li key={label}>
          <span>{label}</span>
          <span className={`badge ${tone(v)}`}>{statusText(v)}</span>
        </li>
      ))}
    </ul>
  );
}

function Gallery({ profile }: { profile: CarProfile }) {
  const groups = [...new Set(profile.photos.map((p) => p.group))];
  const [group, setGroup] = useState(groups[0]);
  const photos = profile.photos.filter((p) => p.group === group);
  const [index, setIndex] = useState(0);
  const current = photos[Math.min(index, photos.length - 1)];

  return (
    <div className="gallery">
      <img className="gallery-main" src={current.src} alt={`${profile.model}, ${current.label.toLowerCase()}`} />
      <div className="gallery-bar">
        <div className="chips">
          {groups.map((g) => (
            <button key={g} className={`chip ${g === group ? 'selected' : ''}`} onClick={() => { setGroup(g); setIndex(0); }}>{g}</button>
          ))}
        </div>
        <span className="fine">{current.label}</span>
      </div>
      <div className="thumbs" role="list">
        {photos.map((p, i) => (
          <button key={p.src} role="listitem" className={`thumb ${p === current ? 'selected' : ''}`} onClick={() => setIndex(i)} aria-label={p.label}>
            <img src={p.src} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}

function VehicleCard({ car }: { car: Device }) {
  const [collapsed, toggleCollapsed] = useCollapsed(`car:${car.id}`);
  const s = car.state;
  const profile = profileFor(car);
  const name = car.prefs?.name || (profile ? `${profile.name} ${profile.year}` : displayName(car));
  const c = s.charge ?? {};
  const t = s.trip ?? {};
  const h = s.health ?? {};
  const warnings = s.warnings ?? [];
  // An electric car has no fuel endpoint; don't report that as missing.
  const unavailable = (s.unavailable ?? []).filter(
    (u) => UNAVAILABLE_LABELS[u] && !(u === 'fuel' && s.batteryPercent != null) && !(u === 'details' && profile),
  );
  const reported = ago(s.reportedAt);
  const chargingActive = s.charging && !['IDLE', 'DONE', 'UNSPECIFIED'].includes(s.charging);

  return (
    <article className="card vehicle">
      {profile && !collapsed && <Gallery profile={profile} />}
      <header className="vehicle-head">
        <div>
          <h2>{name}</h2>
          <div className="device-sub">
            <span className={`badge ${s.locked == null ? 'muted' : s.locked ? 'ok' : 'warn'}`}>
              {s.locked == null ? 'Lock unknown' : s.locked ? 'Locked' : 'Unlocked'}
            </span>
            {s.engineRunning != null && <span className={`badge ${s.engineRunning ? 'info' : 'muted'}`}>{s.engineRunning ? 'Engine running' : 'Engine off'}</span>}
            {s.charging && <span className={`badge ${chargingActive ? 'info' : 'muted'}`}>{words(s.charging)}</span>}
            {warnings.length > 0 && <span className="badge warn">{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>}
          </div>
          <p className="fine">VIN {car.providerId}{reported && ` · reported ${reported}`}</p>
        </div>
        {profile ? null : s.imageUrl ? <img className="car-img" src={s.imageUrl} alt="" /> : <span className="car-icon"><Icon name="vehicle" size={56} /></span>}
        <CollapseButton collapsed={collapsed} onToggle={toggleCollapsed} label={name} />
      </header>
      {!collapsed && (<>

      <div className="stats">
        {s.batteryPercent != null && (
          <Stat label="Battery" value={num(s.batteryPercent)} unit="%">
            <span className="meter"><span style={{ width: `${Math.min(100, s.batteryPercent)}%` }} /></span>
          </Stat>
        )}
        {s.rangeKm != null && <Stat label="Electric range" value={num(s.rangeKm)} unit="km" />}
        {s.fuelLiters != null && <Stat label="Fuel" value={num(s.fuelLiters, 1)} unit="L" />}
        {t.distanceToEmptyTankKm != null && <Stat label="Fuel range" value={num(t.distanceToEmptyTankKm)} unit="km" />}
        <Stat label="Odometer" value={num(s.odometerKm)} unit="km" />
      </div>

      {warnings.length > 0 && (
        <div className="warning">
          <b>Warnings:</b> {warnings.map((w) => `${words(w.name.replace(/Warning$/, ''))} (${statusText(w.value).toLowerCase()})`).join(', ')}
        </div>
      )}
      {(s.doorsOpen?.length ?? 0) + (s.windowsOpen?.length ?? 0) > 0 && (
        <div className="warning">
          <b>Open:</b> {[...(s.doorsOpen ?? []), ...(s.windowsOpen ?? [])].map(words).join(', ')}
        </div>
      )}

      {s.charge && (
        <Section title="Charging">
          <div className="kv">
            <span>Status</span><b>{s.charging ? words(s.charging) : '—'}</b>
            <span>Charger</span><b>{c.connection ? words(c.connection) : '—'}</b>
            {c.type && c.type !== 'NONE' && <><span>Type</span><b>{c.type}</b></>}
            {c.powerW != null && <><span>Power</span><b>{num(c.powerW / 1000, 1)} kW</b></>}
            {c.targetPercent != null && <><span>Target</span><b>{c.targetPercent}%</b></>}
            {c.minutesToTarget != null && chargingActive && <><span>Time to target</span><b>{Math.floor(c.minutesToTarget / 60)} h {c.minutesToTarget % 60} min</b></>}
            {c.currentLimitA != null && <><span>Current limit</span><b>{c.currentLimitA} A</b></>}
          </div>
        </Section>
      )}

      {s.trip && (
        <Section title="Trip statistics">
          <div className="kv">
            {t.avgEnergyKwhPer100km != null && <><span>Avg. energy use</span><b>{num(t.avgEnergyKwhPer100km, 1)} kWh/100 km</b></>}
            {t.avgFuelLPer100km != null && <><span>Avg. fuel use</span><b>{num(t.avgFuelLPer100km, 1)} L/100 km</b></>}
            {t.avgSpeedKmh != null && <><span>Avg. speed</span><b>{num(t.avgSpeedKmh)} km/h</b></>}
            {t.tripAutomaticKm != null && <><span>Trip (automatic)</span><b>{num(t.tripAutomaticKm, 1)} km</b></>}
            {t.tripManualKm != null && <><span>Trip (manual)</span><b>{num(t.tripManualKm, 1)} km</b></>}
            {t.distanceToEmptyBatteryKm != null && <><span>Battery to empty</span><b>{num(t.distanceToEmptyBatteryKm)} km</b></>}
          </div>
        </Section>
      )}

      <div className="v-grid">
        {s.doors && (
          <Section title="Doors">
            <StatusList items={[['Central lock', s.locked == null ? undefined : s.locked ? 'LOCKED' : 'UNLOCKED'], ...Object.entries(s.doors).map(([k, v]) => [words(k.replace(/Door$/, '')), v] as [string, string])]} />
          </Section>
        )}
        {s.windows && (
          <Section title="Windows">
            <StatusList items={Object.entries(s.windows).map(([k, v]) => [words(k.replace(/Window$/, '')), v])} />
          </Section>
        )}
        {s.tyres && (
          <Section title="Tyres">
            <StatusList items={Object.entries(s.tyres).map(([k, v]) => [words(k), v])} />
          </Section>
        )}
        <Section title="Health">
          <StatusList items={[
            ['Engine oil', h.oil],
            ['Coolant', h.coolant],
            ['Brake fluid', h.brakeFluid],
            ...(h.washerFluid ? [['Washer fluid', h.washerFluid] as [string, string]] : []),
            ...(h.service ? [['Service', h.service] as [string, string]] : []),
            ...(s.lampChecks ? [['Lights & bulbs', warnings.some((w) => w.name.endsWith('Warning')) ? 'FAILURE' : 'NO_WARNING'] as [string, string]] : []),
          ]} />
          {s.service && (
            <p className="fine">
              Next service in {[s.service.distanceKm != null && `${num(s.service.distanceKm)} km`, s.service.months != null && `${s.service.months} months`, s.service.engineHours != null && `${s.service.engineHours} engine hours`].filter(Boolean).join(' or ')}
            </p>
          )}
        </Section>
      </div>

      {s.location && (
        <Section title="Location">
          <p className="loc">
            {s.location.lat.toFixed(5)}, {s.location.lon.toFixed(5)}
            {s.location.heading != null && ` · heading ${Math.round(s.location.heading)}°`}
            {s.location.at && ` · ${ago(s.location.at)}`}
            {' '}
            <a href={`https://www.google.com/maps?q=${s.location.lat},${s.location.lon}`} target="_blank" rel="noreferrer">Open map ↗</a>
          </p>
        </Section>
      )}

      {profile && (
        <Section title="Vehicle">
          <div className="kv">
            <span>Model</span><b>{profile.model}</b>
            <span>Model year</span><b>{profile.year}</b>
            <span>Powertrain</span><b>{profile.powertrain}</b>
            <span>Colour</span><b><span className="swatch" style={{ background: profile.colorHex }} /> {profile.color}</b>
            <span>VIN</span><b>{car.providerId}</b>
            {profile.manualUrl && <><span>Owner's manual</span><b><a href={profile.manualUrl} target="_blank" rel="noreferrer">Open PDF (Spanish) ↗</a></b></>}
          </div>
          {profile.photoCredit && <p className="fine">{profile.photoCredit}</p>}
        </Section>
      )}

      {s.details && !profile && (
        <Section title="Vehicle">
          <div className="kv">
            {s.details.model && <><span>Model</span><b>{s.details.model}{s.details.modelYear ? ` (${s.details.modelYear})` : ''}</b></>}
            {s.details.fuelType && <><span>Powertrain</span><b>{words(s.details.fuelType)}</b></>}
            {s.details.batteryCapacityKwh && <><span>Battery capacity</span><b>{s.details.batteryCapacityKwh} kWh</b></>}
            {s.details.color && <><span>Colour</span><b>{s.details.color}</b></>}
            {s.details.gearbox && <><span>Gearbox</span><b>{words(s.details.gearbox)}</b></>}
          </div>
        </Section>
      )}

      {unavailable.length > 0 && (
        <p className="fine">Not provided by Volvo for this app: {unavailable.map((u) => UNAVAILABLE_LABELS[u]).join('; ')}.</p>
      )}
      </>)}
    </article>
  );
}
