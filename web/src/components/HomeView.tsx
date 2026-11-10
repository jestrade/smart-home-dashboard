import { useMemo, useState } from 'react';
import { DeviceCard, type Run } from './DeviceCard';
import { Icon } from './Icon';
import { PROVIDERS } from '../providers';
import { roomOf, type Device, type DevicePrefs, type ProviderId } from '../types';

export function HomeView({ devices, run, pending, onPrefs, onConnect }: {
  devices: Device[]; run: Run; pending: Set<string>;
  onPrefs: (id: string, prefs: DevicePrefs) => void; onConnect: () => void;
}) {
  const [filter, setFilter] = useState<ProviderId | 'all'>('all');
  const [showHidden, setShowHidden] = useState(false);

  const home = devices.filter((d) => !['vehicle', 'charger', 'solar'].includes(d.type) && !d.stale);
  const visible = home.filter((d) => (showHidden || !d.prefs?.hidden) && (filter === 'all' || d.provider === filter));
  const rooms = useMemo(() => [...new Set(home.map(roomOf))].sort(), [home]);
  const providersPresent = PROVIDERS.filter((p) => home.some((d) => d.provider === p.id));
  const hiddenCount = home.filter((d) => d.prefs?.hidden).length;

  const grouped = useMemo(() => {
    const m = new Map<string, Device[]>();
    for (const d of visible) {
      const r = roomOf(d);
      m.set(r, [...(m.get(r) ?? []), d]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b)));
  }, [visible]);
  const favorites = visible.filter((d) => d.prefs?.favorite);

  if (home.length === 0) {
    return (
      <div className="empty">
        <Icon name="home" size={40} />
        <p>No devices yet. Connect an integration to get started.</p>
        <button className="btn primary" onClick={onConnect}>Set up integrations</button>
      </div>
    );
  }

  const card = (d: Device) => (
    <DeviceCard key={d.id} device={d} run={run} pending={pending.has(d.id)} onPrefs={onPrefs} rooms={rooms} />
  );

  return (
    <>
      <Summary devices={devices} />
      <div className="chips filter">
        <button className={`chip ${filter === 'all' ? 'selected' : ''}`} onClick={() => setFilter('all')}>All</button>
        {providersPresent.map((p) => (
          <button key={p.id} className={`chip ${filter === p.id ? 'selected' : ''}`} onClick={() => setFilter(p.id)}>
            <span className="dot" style={{ background: p.color }} /> {p.name}
          </button>
        ))}
        {hiddenCount > 0 && (
          <button className={`chip ${showHidden ? 'selected' : ''}`} onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Hide' : 'Show'} hidden ({hiddenCount})
          </button>
        )}
      </div>

      {favorites.length > 0 && filter === 'all' && (
        <section>
          <h2 className="section-title">Favorites</h2>
          <div className="grid">{favorites.map(card)}</div>
        </section>
      )}
      {grouped.map(([room, list]) => (
        <section key={room}>
          <h2 className="section-title">{room} <span className="count">{list.length}</span></h2>
          <div className="grid">{list.map(card)}</div>
        </section>
      ))}
    </>
  );
}

function Summary({ devices }: { devices: Device[] }) {
  const live = devices.filter((d) => d.online && !d.stale);
  const lightsOn = live.filter((d) => d.type === 'light' && d.state.on).length;
  const thermo = live.find((d) => d.type === 'thermostat' && d.state.temperature != null)
    ?? live.find((d) => d.state.temperature != null);
  const locks = live.filter((d) => d.type === 'lock');
  const unlocked = locks.filter((d) => d.state.locked === false).length;
  const car = live.find((d) => d.type === 'vehicle');
  const charger = live.find((d) => d.type === 'charger');
  const solar = live.find((d) => d.type === 'solar');

  const tiles = [
    { icon: 'light', label: 'Lights on', value: String(lightsOn) },
    thermo && { icon: 'thermostat', label: 'Inside', value: `${thermo.state.temperature}°` },
    locks.length > 0 && { icon: unlocked ? 'unlock' : 'lock', label: 'Locks', value: unlocked ? `${unlocked} open` : 'All locked', warn: unlocked > 0 },
    car && {
      icon: 'vehicle',
      label: 'Car',
      value: car.state.batteryPercent != null ? `${car.state.batteryPercent}%` : car.state.locked ? 'Locked' : 'Unlocked',
      warn: car.state.locked === false,
    },
    solar && { icon: 'sun', label: 'Solar now', value: `${solar.state.powerKw ?? 0} kW` },
    charger && {
      icon: 'charger',
      label: 'Charger',
      value: charger.state.statusGroup === 'charging' && charger.state.chargingPowerKw != null
        ? `${charger.state.chargingPowerKw} kW` : charger.state.statusLabel ?? '—',
      warn: charger.state.statusGroup === 'error',
    },
  ].filter(Boolean) as { icon: string; label: string; value: string; warn?: boolean }[];

  return (
    <div className="summary">
      {tiles.map((t) => (
        <div key={t.label} className={`tile ${t.warn ? 'warn' : ''}`}>
          <Icon name={t.icon as 'light'} />
          <div><div className="label">{t.label}</div><div className="tile-value">{t.value}</div></div>
        </div>
      ))}
    </div>
  );
}
