// Home tab card: the 3D floor plan, the device picked on it, and (in edit mode) room placement.
import { lazy, Suspense, useEffect, useId, useMemo, useState } from 'react';
import { CollapseButton, useCollapsed } from '../components/Collapse';
import { DeviceCard, type Run } from '../components/DeviceCard';
import { Icon } from '../components/Icon';
import { displayName, roomOf, type Device, type DevicePrefs, type HomeLayout } from '../types';
import { placePins, zoneMap } from './mapping';
import { ZONES } from './plan';
import { CATEGORIES, categoryOf } from './categories';

const FloorplanScene = lazy(() => import('./FloorplanScene'));

// The car, charger and solar plant have their own tabs; on the plan they are pins with a summary.
const OWN_TAB = new Set(['vehicle', 'charger', 'solar']);

// The chosen categories are a per-viewer convenience, remembered in this browser only.
const FILTER_KEY = 'floorplan:filter';
function loadFilter(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const kw = (v?: number) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const kwh = (v?: number) => (v == null ? null : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`);

/** Solar generation, home load and grid power right now, shown at the side of the 3D plan. */
function EnergyNow({ station }: { station: Device }) {
  const s = station.state;
  const grid = s.flow?.gridKw; // + selling to the grid, − buying from it
  const day = s.periods?.day ?? {};
  const dir = grid == null || Math.abs(grid) < 0.01 ? 'idle' : grid > 0 ? 'export' : 'import';
  return (
    <div className="plan-energy" aria-label="Energy right now">
      <div>
        <span className="label">PV</span>
        <b>{kw(s.powerKw)}<small> kW</small></b>
        {kwh(day.producedKwh ?? s.todayKwh) && <span className="fine">Today {kwh(day.producedKwh ?? s.todayKwh)}</span>}
      </div>
      <div>
        <span className="label">Load</span>
        <b>{kw(s.flow?.homeLoadKw)}<small> kW</small></b>
        {kwh(day.consumedKwh) && <span className="fine">Today {kwh(day.consumedKwh)}</span>}
      </div>
      <div>
        <span className="label">Grid</span>
        <b>{kw(grid == null ? undefined : Math.abs(grid))}<small> kW</small></b>
        <span className={`badge ${dir === 'import' ? 'info' : dir === 'export' ? 'ok' : 'muted'}`}>
          {dir === 'import' ? 'Importing' : dir === 'export' ? 'Exporting' : 'Idle'}
        </span>
        {(day.importKwh != null || day.exportKwh != null) && (
          <span className="fine grid-day">Today ↓ {kwh(day.importKwh) ?? '—'} · ↑ {kwh(day.exportKwh) ?? '—'}</span>
        )}
      </div>
    </div>
  );
}

export function Floorplan({ devices, layout, onLayout, run, pending, onPrefs }: {
  devices: Device[]; layout: HomeLayout; onLayout: (l: HomeLayout) => void;
  run: Run; pending: Set<string>; onPrefs: (id: string, prefs: DevicePrefs) => void;
}) {
  const [collapsed, toggle] = useCollapsed('floorplan');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const bodyId = useId();

  const live = useMemo(() => devices.filter((d) => !d.prefs?.hidden && !d.stale), [devices]);
  const station = live.find((d) => d.type === 'solar');
  const rooms = useMemo(() => [...new Set(live.map(roomOf))].filter((r) => r !== 'Unassigned').sort(), [live]);
  const saved = layout.floorplan ?? {};
  const map = useMemo(() => zoneMap(rooms, saved.zones), [rooms, saved.zones]);
  const allPins = useMemo(() => placePins(live, map, saved.pins), [live, map, saved.pins]);

  // Category filter: empty means everything.
  const [filter, setFilter] = useState<string[]>(loadFilter);
  useEffect(() => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch { /* private mode */ }
  }, [filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of allPins) c[categoryOf(p.device)] = (c[categoryOf(p.device)] ?? 0) + 1;
    return c;
  }, [allPins]);
  const present = CATEGORIES.filter((c) => counts[c.id]);
  const active = filter.filter((id) => counts[id]);
  const pins = useMemo(() => (active.length ? allPins.filter((p) => active.includes(categoryOf(p.device))) : allPins), [allPins, active.join()]);
  const toggleCategory = (id: string) => setFilter(active.includes(id) ? active.filter((x) => x !== id) : [...active, id]);
  useEffect(() => {
    if (selected && !pins.some((p) => p.device.id === selected)) setSelected(null);
  }, [pins, selected]);

  const labels = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [room, zid] of Object.entries(map)) if (zid) (out[zid] ??= []).push(room);
    return out;
  }, [map]);
  const offPlan = live.filter((d) => !allPins.some((p) => p.device.id === d.id));

  const save = (floorplan: NonNullable<HomeLayout['floorplan']>) => onLayout({ ...layout, floorplan: { ...saved, ...floorplan } });
  const setZone = (room: string, zid: string) => save({ zones: { ...saved.zones, [room]: zid } });
  const movePin = (id: string, x: number, z: number) => save({ pins: { ...saved.pins, [id]: [x, z] } });

  const pick = live.find((d) => d.id === selected);
  const pickPin = pins.find((p) => p.device.id === selected);

  return (
    <section className={`card floorplan ${collapsed ? 'collapsed' : ''}`} aria-label="Floor plan">
      <div className="widget-head">
        <span className="label">Floor plan</span>
        {collapsed && <span className="widget-summary">{pins.length} devices in {Object.keys(labels).length} spaces</span>}
        {!collapsed && (
          <button type="button" className={`btn small plan-edit-btn ${editing ? 'primary' : ''}`} onClick={() => { setEditing(!editing); setSelected(null); }}>
            <Icon name="edit" size={14} /> {editing ? 'Done' : 'Edit'}
          </button>
        )}
        <CollapseButton collapsed={collapsed} onToggle={toggle} label="Floor plan" controls={bodyId} />
      </div>
      {!collapsed && (
        <div id={bodyId} className="floorplan-body">
          {present.length > 1 && (
            <div className="plan-filter" role="group" aria-label="Show devices by category">
              <button type="button" className={`chip ${active.length === 0 ? 'on' : ''}`} aria-pressed={active.length === 0} onClick={() => setFilter([])}>
                All <span className="chip-count">{allPins.length}</span>
              </button>
              {present.map((c) => (
                <button key={c.id} type="button" className={`chip ${active.includes(c.id) ? 'on' : ''}`} aria-pressed={active.includes(c.id)} onClick={() => toggleCategory(c.id)}>
                  <Icon name={c.icon as 'light'} size={14} /> {c.label} <span className="chip-count">{counts[c.id]}</span>
                </button>
              ))}
            </div>
          )}
          <div className="plan-wrap">
            <Suspense fallback={<div className="plan-stage loading"><span className="fine">Loading the 3D plan…</span></div>}>
              <FloorplanScene pins={pins} labels={labels} selected={selected} editing={editing} onSelect={setSelected} onMove={movePin} />
            </Suspense>
            {station && !editing && <EnergyNow station={station} />}
          </div>

          {editing ? (
            <div className="plan-edit">
              <p className="fine">Drag a device to move it inside its room. Choose where each of your rooms is on the plan:</p>
              <div className="plan-rooms">
                {rooms.map((room) => (
                  <label key={room} className="plan-room">
                    <span>{room}</span>
                    <select value={map[room] ?? ''} onChange={(e) => setZone(room, e.target.value)}>
                      <option value="">Not on the plan</option>
                      {ZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {saved.pins && Object.keys(saved.pins).length > 0 && (
                <button type="button" className="btn small" onClick={() => save({ pins: {} })}>Reset device positions</button>
              )}
            </div>
          ) : pick && pickPin ? (
            <div className="plan-pick">
              <p className="fine">{pickPin.zone.label}{roomOf(pick) !== pickPin.zone.label ? ` · ${roomOf(pick)}` : ''}</p>
              {OWN_TAB.has(pick.type)
                ? <p><b>{displayName(pick)}</b> — see the {pick.type === 'vehicle' ? 'Car' : pick.type === 'charger' ? 'Charger' : 'Solar'} tab for details.</p>
                : <DeviceCard device={pick} run={run} pending={pending.has(pick.id)} onPrefs={onPrefs} rooms={rooms} />}
            </div>
          ) : (
            <p className="fine plan-hint">
              Tap a device to control it. Drag to rotate, pinch or scroll to zoom.
              {offPlan.length > 0 && ` ${offPlan.length} device${offPlan.length > 1 ? 's have' : ' has'} no room on the plan (Edit to place rooms).`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
