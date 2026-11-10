import { useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DeviceCard, type Run } from './DeviceCard';
import { Icon } from './Icon';
import { PROVIDERS } from '../providers';
import { displayName, roomOf, type Device, type DevicePrefs, type HomeLayout, type ProviderId } from '../types';

// ---------- drag & drop plumbing ----------

const FAV = '__favorites';
const UNASSIGNED = 'Unassigned';
const favId = (id: string) => `fav|${id}`;
const roomId = (room: string) => `room|${room}`;
const dropId = (room: string) => `drop|${room}`;
const unFav = (id: string) => id.replace(/^fav\|/, '');

/** Drags start anywhere on a card except on its controls; the grip handle always works. */
function startsDrag(target: EventTarget | null) {
  const el = target as Element | null;
  if (el?.closest('[data-dnd-handle]')) return true;
  return !el?.closest('button, input, select, textarea, a, label, [data-no-dnd]');
}
class CardMouseSensor extends MouseSensor {
  static activators = [{ eventName: 'onMouseDown' as const, handler: ({ nativeEvent: e }: { nativeEvent: MouseEvent }) => e.button === 0 && startsDrag(e.target) }];
}
class CardTouchSensor extends TouchSensor {
  static activators = [{ eventName: 'onTouchStart' as const, handler: ({ nativeEvent: e }: { nativeEvent: TouchEvent }) => startsDrag(e.target) }];
}
/** Keyboard dragging only from the grip handle, so Enter on a card still opens it. */
class HandleKeyboardSensor extends KeyboardSensor {
  static activators = [{
    eventName: 'onKeyDown' as const,
    handler: (event: { nativeEvent: KeyboardEvent }, opts: Parameters<(typeof KeyboardSensor.activators)[0]['handler']>[1], ctx: Parameters<(typeof KeyboardSensor.activators)[0]['handler']>[2]) =>
      Boolean((event.nativeEvent.target as Element | null)?.closest('[data-dnd-handle]')) &&
      KeyboardSensor.activators[0].handler(event as never, opts, ctx),
  }];
}

function SortableCard({ id, disabled, children }: {
  id: string; disabled: boolean; children: (handle: HTMLAttributes<HTMLButtonElement> | undefined) => ReactNode;
}) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id, disabled, data: { type: 'card' } });
  return (
    <div ref={setNodeRef} className={`sortable ${isDragging ? 'dragging' : ''}`} {...(disabled ? {} : listeners)}
      style={{ transform: CSS.Translate.toString(transform), transition }}>
      {children(disabled ? undefined : (attributes as HTMLAttributes<HTMLButtonElement>))}
    </div>
  );
}

function SortableRoom({ room, disabled, count, children }: { room: string; disabled: boolean; count: number; children: ReactNode }) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: roomId(room), disabled, data: { type: 'room' } });
  return (
    <section ref={setNodeRef} className={`room ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <h2 className="section-title">
        {!disabled && (
          <button className="grip" data-dnd-handle aria-label={`Move room ${room}`} {...attributes} {...listeners}>
            <Icon name="grip" size={16} />
          </button>
        )}
        {room} <span className="count">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function DropGrid({ room, children }: { room: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(room) });
  return <div ref={setNodeRef} className={`grid ${isOver ? 'drop-over' : ''}`}>{children}</div>;
}

const byName = (devices: Map<string, Device>) => (a: string, b: string) =>
  displayName(devices.get(a)!).localeCompare(displayName(devices.get(b)!));

/** Saved order first, then anything new sorted by name. */
function ordered(saved: string[] | undefined, ids: string[], cmp: (a: string, b: string) => number) {
  const keep = (saved ?? []).filter((id) => ids.includes(id));
  return [...keep, ...ids.filter((id) => !keep.includes(id)).sort(cmp)];
}

// ---------- Home view ----------

export function HomeView({ devices, run, pending, onPrefs, onConnect, layout, onLayout }: {
  devices: Device[]; run: Run; pending: Set<string>;
  onPrefs: (id: string, prefs: DevicePrefs) => void; onConnect: () => void;
  layout: HomeLayout; onLayout: (layout: HomeLayout) => void;
}) {
  const [filter, setFilter] = useState<ProviderId | 'all'>('all');
  const [showHidden, setShowHidden] = useState(false);
  const [drag, setDrag] = useState<null | { type: 'card' | 'room'; id: string; from: string; items: Record<string, string[]>; rooms: string[] }>(null);

  const home = devices.filter((d) => !['vehicle', 'charger', 'solar'].includes(d.type) && !d.stale);
  const visible = home.filter((d) => (showHidden || !d.prefs?.hidden) && (filter === 'all' || d.provider === filter));
  const byId = useMemo(() => new Map(home.map((d) => [d.id, d])), [home]);
  const allRooms = useMemo(() => [...new Set(home.map(roomOf))].sort(), [home]);
  const providersPresent = PROVIDERS.filter((p) => home.some((d) => d.provider === p.id));
  const hiddenCount = home.filter((d) => d.prefs?.hidden).length;
  // Rearranging a filtered list would scramble the full order, so dragging needs the full view.
  const canDrag = filter === 'all';

  const base = useMemo(() => {
    const cmp = byName(byId);
    const present = [...new Set(visible.map(roomOf))];
    const defaultRoomSort = (a: string, b: string) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b));
    const rooms = [...layout.rooms.filter((r) => present.includes(r)), ...present.filter((r) => !layout.rooms.includes(r)).sort(defaultRoomSort)];
    const items: Record<string, string[]> = {};
    for (const r of rooms) items[r] = ordered(layout.order[r], visible.filter((d) => roomOf(d) === r).map((d) => d.id), cmp);
    items[FAV] = ordered(layout.order[FAV], visible.filter((d) => d.prefs?.favorite).map((d) => d.id), cmp);
    return { rooms, items };
  }, [visible, layout, byId]);

  const items = drag?.items ?? base.items;
  const rooms = drag?.rooms ?? base.rooms;
  const containerOf = (id: string, its = items) =>
    id.startsWith('fav|') ? FAV : id.startsWith('drop|') ? id.slice(5) : Object.keys(its).find((k) => k !== FAV && its[k].includes(id));

  const sensors = useSensors(
    useSensor(CardMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(CardTouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(HandleKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Rooms only collide with rooms; favorites only with favorites; room cards with room cards and room drop zones.
  const collision: CollisionDetection = (args) => {
    const a = String(args.active.id);
    const allowed = (id: string) =>
      a.startsWith('room|') ? id.startsWith('room|') : a.startsWith('fav|') ? id.startsWith('fav|') : !id.startsWith('room|') && !id.startsWith('fav|');
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => allowed(String(c.id))) });
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id);
    const type = id.startsWith('room|') ? 'room' : 'card';
    setDrag({ type, id, from: type === 'room' ? '' : containerOf(id) ?? '', items: structuredClone(base.items), rooms: [...base.rooms] });
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!drag || drag.type !== 'card' || !over) return;
    const id = String(active.id);
    if (id.startsWith('fav|')) return;
    const from = containerOf(id, drag.items);
    const to = containerOf(String(over.id), drag.items);
    if (!from || !to || from === to || to === FAV || to === UNASSIGNED) return;
    const next = { ...drag.items, [from]: drag.items[from].filter((x) => x !== id) };
    const target = [...drag.items[to]];
    const overIndex = target.indexOf(String(over.id));
    target.splice(overIndex < 0 ? target.length : overIndex, 0, id);
    next[to] = target;
    setDrag({ ...drag, items: next });
  };

  const save = (nextRooms: string[], changed: Record<string, string[]>) => {
    // Keep entries for rooms/devices not shown right now (hidden devices, other rooms).
    const shown = new Set(Object.values(base.items).flat());
    const order = { ...layout.order };
    for (const [k, ids] of Object.entries(changed)) {
      order[k] = [...ids, ...(layout.order[k] ?? []).filter((x) => !ids.includes(x) && !shown.has(x))];
    }
    const roomList = [...nextRooms, ...layout.rooms.filter((r) => !nextRooms.includes(r))];
    onLayout({ rooms: roomList, order });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const d = drag;
    setDrag(null);
    if (!d || !over) return;
    const id = String(active.id);
    const overId = String(over.id);
    if (d.type === 'room') {
      const from = d.rooms.indexOf(id.slice(5));
      const to = d.rooms.indexOf(overId.slice(5));
      if (from < 0 || to < 0 || from === to) return;
      save(arrayMove(d.rooms, from, to), {});
      return;
    }
    if (id.startsWith('fav|')) {
      const list = d.items[FAV].map(favId);
      const from = list.indexOf(id);
      const to = list.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      save(d.rooms, { [FAV]: arrayMove(d.items[FAV], from, to) });
      return;
    }
    const container = containerOf(id, d.items);
    if (!container) return;
    let list = d.items[container];
    const from = list.indexOf(id);
    const to = list.indexOf(overId);
    if (to >= 0 && from !== to) list = arrayMove(list, from, to);
    const changed: Record<string, string[]> = { [container]: list };
    if (container !== d.from && d.items[d.from]) changed[d.from] = d.items[d.from];
    save(d.rooms, changed);
    if (container !== d.from) {
      const dev = byId.get(id)!;
      onPrefs(id, { ...dev.prefs, room: container });
    }
  };

  if (home.length === 0) {
    return (
      <div className="empty">
        <Icon name="home" size={40} />
        <p>No devices yet. Connect an integration to get started.</p>
        <button className="btn primary" onClick={onConnect}>Set up integrations</button>
      </div>
    );
  }

  const card = (sortId: string, deviceId: string) => {
    const d = byId.get(deviceId);
    if (!d) return null;
    return (
      <SortableCard key={sortId} id={sortId} disabled={!canDrag}>
        {(handle) => <DeviceCard device={d} run={run} pending={pending.has(d.id)} onPrefs={onPrefs} rooms={allRooms} handle={handle} />}
      </SortableCard>
    );
  };

  const activeDevice = drag?.type === 'card' ? byId.get(unFav(drag.id)) : undefined;

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
      <p className="fine drag-hint">
        {canDrag ? 'Drag cards to reorder them or move them to another room; drag a room by its grip to reorder rooms. On touch screens, press and hold.' : 'Choose "All" to rearrange cards.'}
      </p>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver}
        onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
        {items[FAV].length > 0 && filter === 'all' && (
          <section>
            <h2 className="section-title">Favorites</h2>
            <SortableContext items={items[FAV].map(favId)} strategy={rectSortingStrategy}>
              <div className="grid">{items[FAV].map((id) => card(favId(id), id))}</div>
            </SortableContext>
          </section>
        )}
        <SortableContext items={rooms.map(roomId)} strategy={verticalListSortingStrategy}>
          {rooms.map((room) => (
            <SortableRoom key={room} room={room} disabled={!canDrag} count={items[room]?.length ?? 0}>
              <SortableContext items={items[room] ?? []} strategy={rectSortingStrategy}>
                <DropGrid room={room}>{(items[room] ?? []).map((id) => card(id, id))}</DropGrid>
              </SortableContext>
            </SortableRoom>
          ))}
        </SortableContext>
        <DragOverlay>
          {activeDevice ? (
            <div className="card device drag-overlay">
              <div className="device-head">
                <span className="device-icon"><Icon name={activeDevice.type} /></span>
                <div className="device-text"><div className="device-name">{displayName(activeDevice)}</div></div>
              </div>
            </div>
          ) : drag?.type === 'room' ? (
            <div className="room-overlay"><Icon name="grip" size={16} /> {drag.id.slice(5)}</div>
          ) : null}
        </DragOverlay>
      </DndContext>
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
