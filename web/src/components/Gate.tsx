import { useState } from 'react';
import { Icon } from './Icon';
import type { Backend } from '../data';
import type { AccessStatus, AppUser } from '../types';

/** Sign-in screen, plus the one-time "claim this dashboard" step and the access-denied state. */
export function Gate({ backend, user, access, onClaimed }: {
  backend: Backend; user: AppUser | null; access: AccessStatus | 'loading' | 'error'; onClaimed: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="gate">
      <div className="card gate-card">
        <span className="brand-mark"><Icon name="home" size={28} /></span>
        <h1>Smart Home</h1>
        {!user && (
          <>
            <p>Sign in to control your lights, thermostat, locks and car.</p>
            <button className="btn primary" disabled={busy} onClick={() => attempt(backend.signIn)}>Sign in with Google</button>
          </>
        )}
        {user && access === 'loading' && <p>Checking access…</p>}
        {user && access === 'unclaimed' && (
          <>
            <p>This dashboard has no owner yet. Claim it as <b>{user.email}</b>? Others can be added later in Firestore (<code>config/access.emails</code>).</p>
            <button className="btn primary" disabled={busy} onClick={() => attempt(async () => { await backend.claim(); onClaimed(); })}>Claim dashboard</button>
          </>
        )}
        {user && access === 'denied' && (
          <p><b>{user.email}</b> is not on this dashboard's allowlist. Ask the owner to add you.</p>
        )}
        {user && access === 'error' && <p>Could not reach the backend. Are Cloud Functions deployed?</p>}
        {user && <button className="btn ghost" onClick={() => backend.signOut()}>Sign out</button>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
