import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { displayName, type Device } from '../types';

// Read-only view of Wallbox chargers: status, sessions, costs and configuration.

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

export function ChargerView({ chargers, onConnect }: { chargers: Device[]; onConnect: () => void }) {
  if (chargers.length === 0) {
    return (
      <div className="empty">
        <Icon name="charger" size={40} />
        <p>No chargers yet.</p>
        <button className="btn primary" onClick={onConnect}>Connect Wallbox</button>
      </div>
    );
  }
  return <div className="stack">{chargers.map((c) => <ChargerCard key={c.id} charger={c} />)}</div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="v-section"><h3>{title}</h3>{children}</section>;
}

function ChargerCard({ charger }: { charger: Device }) {
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
  const max = s.maxAvailableCurrent;
  const amps = s.maxChargingCurrent;

  return (
    <article className="card vehicle">
      <header className="vehicle-head">
        <div>
          <p className="eyebrow">Wallbox</p>
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
          {amps != null && <><span>Max charging current</span><b>{amps} A{max != null ? ` of ${max} A` : ''} <span className="fine">(≈ {n((amps * volts) / 1000)} kW at {volts} V)</span></b></>}
          {s.software && <><span>Firmware</span><b>{s.software.current}{s.software.updateAvailable ? ` → ${s.software.latest}` : ' (up to date)'}</b></>}
        </div>
      </Section>
    </article>
  );
}
