import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import type { Run } from './DeviceCard';
import { displayName, type Device } from '../types';

const n = (v?: number, digits = 1) =>
  v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits });

function duration(s?: number) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Currencies like COP have large unit prices: show no decimals there, two otherwise. */
function money(v: number | undefined, cur?: string, unitPrice?: number) {
  if (v == null) return '—';
  const big = (unitPrice ?? v) >= 50;
  return `${cur ?? ''}${v.toLocaleString(undefined, { minimumFractionDigits: big ? 0 : 2, maximumFractionDigits: big ? 0 : 2 })}`;
}

const TONE: Record<string, string> = {
  charging: 'info', ready: 'ok', locked: 'muted', paused: 'warn', waiting: 'muted', error: 'warn', idle: 'muted',
};

export function ChargerView({ chargers, run, pending, onConnect }: {
  chargers: Device[]; run: Run; pending: Set<string>; onConnect: () => void;
}) {
  if (chargers.length === 0) {
    return (
      <div className="empty">
        <Icon name="charger" size={40} />
        <p>No chargers yet.</p>
        <button className="btn primary" onClick={onConnect}>Connect Wallbox</button>
      </div>
    );
  }
  return <div className="stack">{chargers.map((c) => <ChargerCard key={c.id} charger={c} run={run} pending={pending.has(c.id)} />)}</div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="v-section"><h3>{title}</h3>{children}</section>;
}

function ChargerCard({ charger, run, pending }: { charger: Device; run: Run; pending: boolean }) {
  const s = charger.state;
  // Live status reports cost 0 for finished sessions; the session list has the real cost.
  const latest = s.sessions?.[0];
  const sess = { ...s.session, cost: s.session?.cost || (s.session?.finished ? latest?.cost : undefined) };
  const price = s.energyPrice;
  // North American models (part number "…-U-…") run at 240 V.
  const volts = /-U-/.test(s.partNumber ?? charger.model ?? '') ? 240 : 230;
  const cur = s.currency;
  const group = s.statusGroup ?? 'idle';
  const charging = group === 'charging';
  const max = s.maxAvailableCurrent ?? 32;
  const [amps, setAmps] = useState(s.maxChargingCurrent ?? max);
  useEffect(() => setAmps(s.maxChargingCurrent ?? max), [s.maxChargingCurrent, max]);
  const commitAmps = () => amps !== s.maxChargingCurrent && run(charger, 'setMaxCurrent', amps);
  const disabled = pending || !charger.online;

  return (
    <article className={`card vehicle ${pending ? 'pending' : ''}`}>
      <header className="vehicle-head">
        <div>
          <h2>{displayName(charger)}</h2>
          <div className="device-sub">
            <span className={`badge ${TONE[group]}`}>{s.statusLabel ?? 'Unknown'}</span>
            {s.locked != null && <span className={`badge ${s.locked ? 'muted' : 'warn'}`}>{s.locked ? 'Locked' : 'Unlocked'}</span>}
            {s.software?.updateAvailable && <span className="badge info">Update {s.software.latest} available</span>}
          </div>
          <p className="fine">
            {s.partNumber ?? charger.model ?? 'Wallbox'} · SN {s.serial ?? charger.providerId}
            {s.lastSync && ` · last sync ${new Date(s.lastSync.replace(' ', 'T') + 'Z').toLocaleString()}`}
          </p>
        </div>
        <span className={`charger-icon ${charging ? 'live' : ''}`}><Icon name="charger" size={52} /></span>
      </header>

      <div className="stats">
        <div className="stat">
          <span className="label">Power</span>
          <span className="big">{charging ? n(s.chargingPowerKw) : '0'}<small> kW</small></span>
          {charging && s.chargingSpeed != null && <span className="fine">{s.chargingSpeed} A</span>}
        </div>
        <div className="stat"><span className="label">{sess.finished === false ? 'This session' : 'Last session'}</span><span className="big">{n(sess.energyKwh)}<small> kWh</small></span></div>
        <div className="stat"><span className="label">Range added</span><span className="big">{n(sess.rangeKm, 0)}<small> km</small></span></div>
        <div className="stat"><span className="label">Duration</span><span className="big" style={{ fontSize: 22 }}>{duration(sess.durationS)}</span></div>
        {sess.cost != null && <div className="stat"><span className="label">Session cost</span><span className="big">{money(sess.cost, cur, price)}</span></div>}
        {s.stateOfCharge != null && <div className="stat"><span className="label">Car battery</span><span className="big">{s.stateOfCharge}<small> %</small></span></div>}
      </div>

      {group === 'error' && <p className="warning">The charger reports an error. Check the myWallbox app.</p>}

      <div className="btn-row">
        {charging || group === 'waiting' ? (
          <button className="btn" disabled={disabled} onClick={() => run(charger, 'pauseCharging')}>Pause charging</button>
        ) : group === 'paused' ? (
          <button className="btn primary" disabled={disabled} onClick={() => run(charger, 'resumeCharging')}>Resume charging</button>
        ) : null}
        {s.locked ? (
          <button className="btn" disabled={disabled} onClick={() => window.confirm('Unlock the charger? Anyone could then start charging.') && run(charger, 'unlock')}>
            <Icon name="unlock" size={18} /> Unlock
          </button>
        ) : (
          <button className="btn" disabled={disabled} onClick={() => run(charger, 'lock')}><Icon name="lock" size={18} /> Lock</button>
        )}
      </div>

      <label className="slider">
        <span>Max charging current <b>{amps} A</b> <span className="fine">(≈ {n((amps * volts) / 1000)} kW at {volts} V)</span></span>
        <input type="range" min={6} max={max} step={1} value={amps} disabled={disabled}
          onChange={(e) => setAmps(Number(e.target.value))} onPointerUp={commitAmps} onKeyUp={commitAmps} />
      </label>

      {s.session && (sess.greenEnergyKwh != null || sess.gridEnergyKwh != null) && (
        <Section title="Energy source (session)">
          <div className="kv">
            <span>From grid</span><b>{n(sess.gridEnergyKwh)} kWh</b>
            <span>Green / solar</span><b>{n(sess.greenEnergyKwh)} kWh</b>
          </div>
        </Section>
      )}

      {s.last30 && (
        <Section title="Last 30 days">
          <div className="stats">
            <div className="stat"><span className="label">Sessions</span><span className="big">{s.last30.sessions}</span></div>
            <div className="stat"><span className="label">Energy</span><span className="big">{n(s.last30.energyKwh, 0)}<small> kWh</small></span></div>
            <div className="stat"><span className="label">Charging time</span><span className="big" style={{ fontSize: 22 }}>{duration(s.last30.durationS)}</span></div>
            <div className="stat"><span className="label">Cost</span><span className="big">{money(s.last30.cost, cur, price)}</span></div>
          </div>
        </Section>
      )}

      {s.sessions && s.sessions.length > 0 && (
        <Section title="Recent sessions">
          <div className="table-wrap">
            <table className="sessions">
              <thead><tr><th>Started</th><th>Duration</th><th>Energy</th><th>Cost</th></tr></thead>
              <tbody>
                {s.sessions.map((x) => (
                  <tr key={x.start}>
                    <td>{new Date(x.start * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td>{duration(x.durationS)}</td>
                    <td>{n(x.energyKwh)} kWh</td>
                    <td>{money(x.cost, cur, price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Configuration">
        <div className="kv">
          {s.energyPrice != null && <><span>Energy price</span><b>{money(s.energyPrice, cur, price)} / kWh</b></>}
          {s.ecoSmart && <><span>Eco-Smart</span><b>{s.ecoSmart.enabled ? `${s.ecoSmart.mode}${s.ecoSmart.percentage != null ? ` (${s.ecoSmart.percentage}%)` : ''}` : 'Off'}</b></>}
          {s.powerBoost != null && <><span>Power Boost</span><b>{s.powerBoost ? 'On' : 'Off'}</b></>}
          {s.autoLock != null && <><span>Auto-lock</span><b>{s.autoLock ? `After ${s.autoLockMinutes ?? '?'} min` : 'Off'}</b></>}
          <span>Available current</span><b>{max} A</b>
          {s.software && <><span>Firmware</span><b>{s.software.current}{s.software.updateAvailable ? ` → ${s.software.latest}` : ' (up to date)'}</b></>}
        </div>
      </Section>
    </article>
  );
}
