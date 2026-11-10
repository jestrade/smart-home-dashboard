import { providerMeta } from '../providers';
import type { ActivityEvent } from '../types';

const ACTION_TEXT: Record<string, (v: unknown) => string> = {
  setOn: (v) => (v ? 'turned on' : 'turned off'),
  setBrightness: (v) => `brightness → ${v}%`,
  setTemperature: (v) => `target → ${v}°`,
  setMode: (v) => `mode → ${String(v).toLowerCase()}`,
  lock: () => 'locked',
  unlock: () => 'unlocked',
  cover: (v) => String(v),
  climateStart: () => 'climate started',
  climateStop: () => 'climate stopped',
  honkFlash: () => 'honk & flash',
  pauseCharging: () => 'charging paused',
  resumeCharging: () => 'charging resumed',
  setMaxCurrent: (v) => `max current → ${v} A`,
  snapshot: () => 'snapshot taken',
};

export function ActivityView({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return <div className="empty"><p>No activity yet. Commands you send show up here.</p></div>;
  return (
    <ul className="card activity">
      {events.map((e) => (
        <li key={e.id} className={e.ok ? '' : 'failed'}>
          <span className="dot" style={{ background: providerMeta(e.provider)?.color }} />
          <div>
            <div><b>{e.deviceName}</b> {ACTION_TEXT[e.action]?.(e.value) ?? e.action}</div>
            {!e.ok && <div className="error-text">{e.error}</div>}
            <div className="fine">{e.user} · {e.at ? e.at.toLocaleString() : 'just now'}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
