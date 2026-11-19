import { useState } from 'react';
import { Icon } from './Icon';
import { useStored } from './Collapse';
import { CATEGORIES, PROVIDERS, type ProviderCategory, type ProviderMeta } from '../providers';
import type { Backend } from '../data';
import type { IntegrationStatus, ProviderId } from '../types';

type Filter = 'all' | 'connected' | 'disconnected';
type Category = ProviderCategory | 'all';

export function IntegrationsView({ backend, status, notify }: {
  backend: Backend;
  status: Partial<Record<ProviderId, IntegrationStatus>>;
  notify: (msg: string, kind?: 'ok' | 'error') => void;
}) {
  // All cards start closed; whatever the user opens stays open across reloads and sign-in redirects.
  const [openIds, setOpenIds] = useStored<ProviderId[]>('integrations.open', []);
  const [filter, setFilter] = useStored<Filter>('integrations.filter', 'all');
  const [category, setCategory] = useStored<Category>('integrations.category', 'all');
  const isConnected = (id: ProviderId) => Boolean(status[id]?.connected);
  const matchesStatus = (p: ProviderMeta, f: Filter) =>
    f === 'all' ? true : f === 'connected' ? isConnected(p.id) : !isConnected(p.id);
  // The category tabs and the status chips combine; each count reflects the other selection.
  const inCategory = PROVIDERS.filter((p) => category === 'all' || p.category === category);
  const counts = {
    all: inCategory.length,
    connected: inCategory.filter((p) => matchesStatus(p, 'connected')).length,
    disconnected: inCategory.filter((p) => matchesStatus(p, 'disconnected')).length,
  };
  const categoryCount = (c: Category) =>
    PROVIDERS.filter((p) => (c === 'all' || p.category === c) && matchesStatus(p, filter)).length;
  const shown = inCategory.filter((p) => matchesStatus(p, filter));
  const toggle = (id: ProviderId) =>
    setOpenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const FILTERS: [Filter, string][] = [['all', 'All'], ['connected', 'Connected'], ['disconnected', 'Not connected']];

  return (
    <div className="stack">
      {backend.mode === 'demo' && (
        <p className="notice">Demo mode: no real accounts are contacted. Add your Firebase config to <code>web/.env.local</code> to go live.</p>
      )}
      <div className="seg" role="tablist" aria-label="Integration categories">
        {([['all', 'All'], ...CATEGORIES] as [Category, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={category === id} className={category === id ? 'on' : ''}
            onClick={() => setCategory(id)}>
            {label} <span className="count">{categoryCount(id)}</span>
          </button>
        ))}
      </div>
      <div className="list-toolbar">
        <div className="chips" role="group" aria-label="Filter integrations">
          {FILTERS.map(([id, label]) => (
            <button key={id} className={`chip ${filter === id ? 'selected' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} <span className="count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <button className="btn ghost small" disabled={openIds.length === 0} onClick={() => setOpenIds([])}>
          Collapse all
        </button>
      </div>
      {shown.map((p) => (
        <IntegrationCard key={p.id} meta={p} status={status[p.id]} backend={backend} notify={notify}
          open={openIds.includes(p.id)} onToggle={() => toggle(p.id)} />
      ))}
      {shown.length === 0 && (
        <p className="empty">{filter === 'connected' ? 'Nothing connected here yet.' : filter === 'disconnected' ? 'Everything here is connected.' : 'No integrations in this category.'}</p>
      )}
    </div>
  );
}

function IntegrationCard({ meta, status, backend, notify, open, onToggle }: {
  meta: ProviderMeta; status?: IntegrationStatus; backend: Backend;
  notify: (msg: string, kind?: 'ok' | 'error') => void;
  open: boolean; onToggle: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [bridgeToken, setBridgeToken] = useState<{ token: string; endpoint: string } | null>(null);
  const set = new Set(status?.fieldsSet ?? []);

  const act = async (label: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(label);
    try {
      await fn();
      if (okMsg) notify(okMsg);
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act('save', async () => {
      await backend.saveIntegration(meta.id, values);
      setValues({});
    }, meta.oauth ? 'Saved. Now press Connect.' : `${meta.name} saved and synced.`);

  const connect = () =>
    act('connect', async () => {
      const { url } = await backend.connectUrl(meta.id);
      window.location.assign(url);
    });

  const badge = status?.connected
    ? status.lastError ? <span className="badge warn">Error</span> : <span className="badge ok">Connected</span>
    : status?.configured ? <span className="badge info">{meta.pendingLabel ?? (meta.oauth ? 'Needs sign-in' : 'Configured')}</span>
    : <span className="badge muted">Not set up</span>;

  return (
    <article className="card integration">
      <header className="integration-head" role="button" tabIndex={0} aria-expanded={open}
        onClick={onToggle} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}>
        <span className="provider-mark" style={{ background: meta.color }}>{meta.name[0]}</span>
        <div className="device-text">
          <div className="device-name">{meta.name} {badge}</div>
          <div className="device-sub">
            {status?.connected
              ? `${status.deviceCount ?? 0} devices · synced ${status.lastSyncAt ? status.lastSyncAt.toLocaleTimeString() : 'never'}`
              : meta.blurb}
          </div>
        </div>
        <span className={`chevron ${open ? 'open' : ''}`}><Icon name="chevron" size={18} /></span>
      </header>

      {status?.lastError && <p className="warning">{status.lastError}</p>}

      {open && (
        <div className="device-body">
          <ol className="steps">
            {meta.steps.map((s) => <li key={s}>{s}</li>)}
            <li><a href={meta.docsUrl} target="_blank" rel="noreferrer">Provider documentation ↗</a></li>
          </ol>
          {meta.webhook && (
            <div className="redirect">
              <span className="label">Target URL to register</span>
              <code>{backend.redirectUri().replace('oauthCallback', 'smartthingsWebhook')}</code>
            </div>
          )}
          {meta.oauth && (
            <div className="redirect">
              <span className="label">Redirect URI to register</span>
              <code>{backend.redirectUri()}</code>
            </div>
          )}
          {meta.bridge && (
            <div className="bridge-setup">
              <button type="button" className="btn primary" disabled={!!busy}
                onClick={() => (!status?.configured || window.confirm('Generate a new bridge token? The current one stops working, so update bridge/config.json afterwards.'))
                  && act('token', async () => setBridgeToken(await backend.createBridgeToken(meta.id)))}>
                {busy === 'token' ? 'Generating…' : status?.configured ? 'Generate a new bridge token' : 'Generate bridge token'}
              </button>
              {bridgeToken && (
                <div className="redirect">
                  <span className="label">bridge/config.json — copy it now, the token is shown only once</span>
                  <pre className="code-block">{JSON.stringify({ endpoint: bridgeToken.endpoint, token: bridgeToken.token, key: 'YOUR-16-CHAR-MOTION-KEY', gatewayIp: null }, null, 2)}</pre>
                  <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(JSON.stringify({ endpoint: bridgeToken.endpoint, token: bridgeToken.token, key: 'YOUR-16-CHAR-MOTION-KEY', gatewayIp: null }, null, 2)).then(() => notify('Copied.'), () => notify('Copy failed — select the text instead.', 'error'))}>
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}
          <form className="fields" onSubmit={(e) => { e.preventDefault(); save(); }}>
            {meta.fields.map((f) => (
              <label key={f.key}>
                <span>{f.label}{f.optional && <em> optional</em>}</span>
                <input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  value={values[f.key] ?? ''}
                  placeholder={set.has(f.key) ? '•••••• saved (leave blank to keep)' : f.placeholder ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
                {f.help && <small>{f.help}</small>}
              </label>
            ))}
            <div className="btn-row">
              {meta.fields.length > 0 && (
                <button type="submit" className="btn primary" disabled={!!busy || Object.values(values).every((v) => !v.trim())}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
              )}
              {meta.oauth && status?.configured && (
                <button type="button" className="btn" disabled={!!busy} onClick={connect}>
                  {busy === 'connect' ? 'Opening…' : status.connected ? 'Reconnect' : 'Connect'}
                </button>
              )}
              {status?.connected && (
                <button type="button" className="btn" disabled={!!busy}
                  onClick={() => act('sync', async () => {
                    const [r] = await backend.sync(meta.id);
                    if (r?.error) throw new Error(r.error);
                  }, `${meta.name} synced.`)}>
                  {busy === 'sync' ? 'Syncing…' : 'Sync now'}
                </button>
              )}
              {status?.configured && (
                <button type="button" className="btn danger" disabled={!!busy}
                  onClick={() => window.confirm(`Remove ${meta.name}, its saved credentials and its devices?`)
                    && act('disconnect', () => backend.disconnect(meta.id), `${meta.name} removed.`)}>
                  Remove
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </article>
  );
}
