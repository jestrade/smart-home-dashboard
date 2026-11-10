import { useEffect, useState, type HTMLAttributes } from 'react';
import { Icon } from './Icon';
import { Toggle } from './Toggle';
import { providerMeta } from '../providers';
import { displayName, roomOf, type Action, type Device, type DevicePrefs } from '../types';

export type Run = (device: Device, action: Action, value?: unknown) => Promise<void>;

const MODE_LABELS: Record<string, string> = { HEAT: 'Heat', COOL: 'Cool', HEATCOOL: 'Heat·Cool', OFF: 'Off', heat: 'Heat', cool: 'Cool', heat_cool: 'Auto', auto: 'Auto', off: 'Off', dry: 'Dry', fan_only: 'Fan' };

export function summary(d: Device): string {
  const s = d.state;
  if (!d.online) return 'Offline';
  const parts: string[] = [];
  if (s.on != null) parts.push(d.type === 'camera' ? (s.on ? 'Camera on' : 'Privacy mode') : s.on ? 'On' : 'Off');
  if (s.on && s.brightness != null && d.capabilities.includes('brightness')) parts.push(`${s.brightness}%`);
  if (d.type === 'thermostat') {
    if (s.mode) parts.push(MODE_LABELS[s.mode] ?? s.mode);
    if (s.targetTemperature != null && s.mode !== 'OFF' && s.mode !== 'off') parts.push(`set ${s.targetTemperature}°`);
  }
  if (s.temperature != null && d.type !== 'thermostat') parts.push(`${s.temperature}°`);
  if (s.humidity != null && d.type !== 'thermostat') parts.push(`${s.humidity}%`);
  if (s.locked != null) parts.push(s.locked ? 'Locked' : 'Unlocked');
  if (d.type === 'cover') parts.push(s.position != null ? `${s.position}% open` : s.open ? 'Open' : 'Closed');
  if (d.type === 'sensor' && s.open != null) parts.push(s.open ? 'Open' : 'Closed');
  if (s.motion) parts.push('Motion');
  if (s.sleeping) parts.push('Asleep');
  if (s.powerW != null && s.on) parts.push(`${Math.round(s.powerW)} W`);
  if (s.battery != null) parts.push(`🔋${s.battery}%`);
  return parts.join(' · ') || (d.type === 'camera' ? 'Camera' : 'Online');
}

const isActive = (d: Device) =>
  d.online && (d.state.on === true || d.state.locked === false || (d.type === 'thermostat' && !!d.state.hvac && d.state.hvac !== 'OFF') || (d.type === 'cover' && (d.state.open || (d.state.position ?? 0) > 0)));

export function DeviceCard({ device, run, pending, onPrefs, rooms, handle }: {
  device: Device; run: Run; pending: boolean; rooms: string[];
  onPrefs: (id: string, prefs: DevicePrefs) => void;
  /** Drag-handle attributes when the card is sortable (keyboard dragging starts here). */
  handle?: HTMLAttributes<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const caps = device.capabilities;
  const s = device.state;
  const p = providerMeta(device.provider);
  const name = displayName(device);

  return (
    <article className={`card device ${isActive(device) ? 'active' : ''} ${device.online ? '' : 'offline'} ${pending ? 'pending' : ''}`}>
      <div className="device-head" role="button" tabIndex={0} aria-expanded={open} aria-label={`${name}, ${summary(device)}`}
        onClick={() => setOpen(!open)} onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(!open))}>
        {handle && (
          <button className="grip" data-dnd-handle aria-label={`Move ${name}`} {...handle} onClick={(e) => e.stopPropagation()}>
            <Icon name="grip" size={16} />
          </button>
        )}
        <span className="device-icon"><Icon name={device.type} /></span>
        <div className="device-text">
          <div className="device-name">{name}{device.prefs?.favorite && <span className="fav" aria-label="Favorite">★</span>}</div>
          <div className="device-sub">
            <span className="dot" style={{ background: p.color }} title={p.name} />
            {summary(device)}
          </div>
        </div>
        {caps.includes('onoff') && (
          <Toggle on={!!s.on} disabled={!device.online || pending} label={`Turn ${name} ${s.on ? 'off' : 'on'}`}
            onChange={(v) => run(device, 'setOn', v)} />
        )}
        {caps.includes('lock') && device.type !== 'vehicle' && (
          <button className="btn small" disabled={!device.online || pending}
            onClick={(e) => { e.stopPropagation(); run(device, s.locked ? 'unlock' : 'lock'); }}>
            {s.locked ? 'Unlock' : 'Lock'}
          </button>
        )}
      </div>

      {open && (
        <div className="device-body">
          {caps.includes('brightness') && <BrightnessSlider device={device} run={run} disabled={!device.online || pending} />}
          {caps.includes('thermostat') && <ThermostatControl device={device} run={run} disabled={!device.online || pending} />}
          {(caps.includes('snapshot') || s.imageUrl) && (
            <CameraSnapshot device={device} run={run} disabled={!device.online || pending} />
          )}
          {caps.includes('cover') && (
            <div className="btn-row">
              {(['open', 'stop', 'close'] as const).map((c) => (
                <button key={c} className="btn" disabled={!device.online || pending} onClick={() => run(device, 'cover', c)}>
                  {c[0].toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
          )}
          {editing ? (
            <PrefsForm device={device} rooms={rooms} onDone={(prefs) => { if (prefs) onPrefs(device.id, prefs); setEditing(false); }} />
          ) : (
            <div className="device-meta">
              <span>{roomOf(device)} · {p.name}{device.model ? ` · ${device.model}` : ''}</span>
              <div className="btn-row tight">
                <button className="btn ghost small" onClick={() => onPrefs(device.id, { ...device.prefs, favorite: !device.prefs?.favorite })}>
                  {device.prefs?.favorite ? 'Unfavorite' : 'Favorite'}
                </button>
                <button className="btn ghost small" onClick={() => setEditing(true)}>Edit</button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function CameraSnapshot({ device, run, disabled }: { device: Device; run: Run; disabled: boolean }) {
  const src = device.state.snapshotUrl ?? device.state.imageUrl;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [src]);
  // A new snapshot takes a few seconds to upload; retry the image a few times.
  const retry = () => attempt < 5 && setTimeout(() => setAttempt((a) => a + 1), 2000);
  return (
    <div className="snapshot">
      {src ? (
        <img key={`${src}#${attempt}`} src={attempt ? `${src}${src.includes('?') ? '&' : '?'}r=${attempt}` : src} alt={`${displayName(device)} snapshot`} onError={retry} />
      ) : (
        <div className="snapshot-empty">No snapshot yet</div>
      )}
      <div className="device-meta">
        <span>{device.state.snapshotAt ? `Snapshot ${new Date(device.state.snapshotAt).toLocaleTimeString()}` : 'Last thumbnail'}</span>
        {device.capabilities.includes('snapshot') && (
          <button className="btn small" disabled={disabled} onClick={() => run(device, 'snapshot')}>Take snapshot</button>
        )}
      </div>
    </div>
  );
}

function BrightnessSlider({ device, run, disabled }: { device: Device; run: Run; disabled: boolean }) {
  const [v, setV] = useState(device.state.brightness ?? 0);
  useEffect(() => setV(device.state.brightness ?? 0), [device.state.brightness]);
  const commit = () => v !== device.state.brightness && run(device, 'setBrightness', v);
  return (
    <label className="slider">
      <span>Brightness <b>{v}%</b></span>
      <input type="range" min={1} max={100} value={v} disabled={disabled}
        onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} />
    </label>
  );
}

function ThermostatControl({ device, run, disabled }: { device: Device; run: Run; disabled: boolean }) {
  const s = device.state;
  const [target, setTarget] = useState(s.targetTemperature ?? 20);
  useEffect(() => setTarget(s.targetTemperature ?? 20), [s.targetTemperature]);
  // Debounce +/- taps into one command.
  useEffect(() => {
    if (target === s.targetTemperature) return;
    const t = setTimeout(() => run(device, 'setTemperature', target), 900);
    return () => clearTimeout(t);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const off = s.mode === 'OFF' || s.mode === 'off';
  const step = (delta: number) => setTarget((t) => Math.min(32, Math.max(9, Math.round((t + delta) * 2) / 2)));

  return (
    <div className="thermo">
      <div className="thermo-row">
        <div>
          <div className="label">Inside</div>
          <div className="big">{s.temperature != null ? `${s.temperature}°` : '—'}</div>
          {s.humidity != null && <div className="label">{s.humidity}% humidity</div>}
        </div>
        <div className="stepper" aria-label="Target temperature">
          <button className="btn round" disabled={disabled || off} onClick={() => step(-0.5)} aria-label="Lower">−</button>
          <div className="big accent">{off ? 'Off' : `${target}°`}</div>
          <button className="btn round" disabled={disabled || off} onClick={() => step(0.5)} aria-label="Raise">+</button>
        </div>
      </div>
      {device.capabilities.includes('mode') && s.availableModes && (
        <div className="chips">
          {s.availableModes.map((m) => (
            <button key={m} className={`chip ${s.mode === m ? 'selected' : ''}`} disabled={disabled}
              onClick={() => run(device, 'setMode', m)}>{MODE_LABELS[m] ?? m}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function PrefsForm({ device, rooms, onDone }: { device: Device; rooms: string[]; onDone: (p?: DevicePrefs) => void }) {
  const [name, setName] = useState(device.prefs?.name ?? '');
  const [room, setRoom] = useState(device.prefs?.room ?? device.suggestedRoom ?? '');
  const [hidden, setHidden] = useState(!!device.prefs?.hidden);
  const listId = `rooms-${device.id}`;
  return (
    <form className="prefs" onSubmit={(e) => { e.preventDefault(); onDone({ ...device.prefs, name: name.trim(), room: room.trim(), hidden }); }}>
      <label>Name<input value={name} placeholder={device.name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Room<input value={room} list={listId} placeholder="e.g. Kitchen" onChange={(e) => setRoom(e.target.value)} /></label>
      <datalist id={listId}>{rooms.map((r) => <option key={r} value={r} />)}</datalist>
      <label className="check"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide from dashboard</label>
      <div className="btn-row tight">
        <button type="button" className="btn ghost small" onClick={() => onDone()}>Cancel</button>
        <button type="submit" className="btn primary small">Save</button>
      </div>
    </form>
  );
}
