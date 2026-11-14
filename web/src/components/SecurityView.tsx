import { useEffect, useState } from 'react';
import { backend } from '../data';
import type { SecurityInfo } from '../types';

// Blocked IPs and recent suspicious requests to the functions. Read once when opened (and on
// "Refresh"), not live, so watching it costs a handful of reads.

const KIND: Record<string, string> = {
  probe: 'Probed a path no part of the app uses',
  'rate-limit': 'Too many requests in a minute',
  'bad-token': 'Wrong bridge token',
  'bad-signature': 'Unsigned SmartThings request',
  'bad-request': 'Malformed or reused request',
  'not-found': 'Unknown address',
  denied: 'Not signed in or not a household member',
  blocked: 'Blocked for 24 hours',
};

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
const left = (t: number) => {
  const h = (t - Date.now()) / 3600000;
  return h >= 1 ? `${Math.round(h)} h left` : `${Math.max(1, Math.round(h * 60))} min left`;
};

export function SecurityView({ notify }: { notify: (msg: string, kind?: 'error' | 'ok') => void }) {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setError(null);
    backend.security().then(setInfo, (e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const unblock = async (ip: string) => {
    setBusy(ip);
    try {
      await backend.unblockIp(ip);
      notify(`${ip} unblocked`, 'ok');
      load();
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const ac = info?.appCheck;
  const acTotal = (ac?.verified ?? 0) + (ac?.missing ?? 0);

  return (
    <article className="card security">
      <div className="security-head">
        <h2>Security</h2>
        <button type="button" className="btn" onClick={load}>Refresh</button>
      </div>
      <p className="fine">
        Requests to the dashboard's server are counted per IP address. An address that sends too many, uses a wrong
        token, or looks for pages like <code>/wp-login.php</code> is blocked for 24 hours. Signed-in household members are never blocked.
      </p>
      {error && <p className="warning">Could not load the security log: {error}</p>}
      {!info && !error && <p className="fine">Loading…</p>}
      {info && (
        <>
          <div className="stats">
            <div className="stat"><span className="label">Blocked now</span><span className="big">{info.blocked.length}</span></div>
            <div className="stat"><span className="label">Suspicious requests (7 days)</span><span className="big">{info.events.filter((e) => e.kind !== 'blocked').length}{info.events.length >= 50 ? '+' : ''}</span></div>
            <div className="stat"><span className="label">App Check</span>
              <span className="big">{!info.appCheckOn ? 'Off' : acTotal ? `${Math.round(((ac?.verified ?? 0) / acTotal) * 100)}%` : 'Watching'}</span>
              <span className="fine">{!info.appCheckOn ? 'Needs a reCAPTCHA key' : acTotal ? `of ${acTotal} calls verified` : 'No calls counted yet'}</span>
            </div>
          </div>

          <h3>Blocked addresses</h3>
          {info.blocked.length === 0 ? <p className="fine">None right now.</p> : (
            <div className="table-wrap"><table className="sessions">
              <thead><tr><th>IP</th><th>Why</th><th>Since</th><th>Ends</th><th /></tr></thead>
              <tbody>{info.blocked.map((b) => (
                <tr key={b.ip}>
                  <td><code>{b.ip}</code></td>
                  <td>{KIND[b.reason?.split(' · ')[0] ?? ''] ?? b.reason}{b.reason?.includes(' · ') && <span className="fine"> · {b.reason.split(' · ')[1]}</span>}</td>
                  <td>{b.at ? ago(b.at) : '—'}</td>
                  <td>{left(b.until)}</td>
                  <td><button type="button" className="btn" disabled={busy === b.ip} onClick={() => unblock(b.ip)}>Unblock</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}

          <h3>Recent suspicious requests</h3>
          {info.events.length === 0 ? <p className="fine">Nothing in the last 7 days.</p> : (
            <div className="table-wrap"><table className="sessions">
              <thead><tr><th>When</th><th>IP</th><th>What</th><th>Where</th><th>Client</th></tr></thead>
              <tbody>{info.events.map((e) => (
                <tr key={e.id}>
                  <td>{ago(e.at)}</td>
                  <td><code>{e.ip}</code></td>
                  <td>{KIND[e.kind] ?? e.kind}</td>
                  <td>{e.path ? <code>{e.path}</code> : e.endpoint ?? '—'}</td>
                  <td className="fine ua">{e.userAgent ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </article>
  );
}
