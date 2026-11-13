import { useCallback, useEffect, useRef, useState } from 'react';
import { backend } from './data';
import { Gate } from './components/Gate';
import { HomeView } from './components/HomeView';
import { VehicleView } from './components/VehicleView';
import { ChargerView } from './components/ChargerView';
import { EnergyView } from './components/EnergyView';
import { SolarView } from './components/SolarView';
import { IntegrationsView } from './components/IntegrationsView';
import { ActivityView } from './components/ActivityView';
import { Icon } from './components/Icon';
import { useStored } from './components/Collapse';
import type { Run } from './components/DeviceCard';
import { providerMeta } from './providers';
import type {
  AccessStatus, ActivityEvent, AppUser, Device, DevicePrefs, HomeLayout, IntegrationStatus, ProviderId,
} from './types';

type Tab = 'home' | 'energy' | 'vehicle' | 'charger' | 'solar' | 'integrations' | 'activity';
const TABS: { id: Tab; label: string; short?: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'energy', label: 'Energy', icon: 'bolt' },
  { id: 'vehicle', label: 'Car', icon: 'vehicle' },
  { id: 'charger', label: 'Charger', icon: 'charger' },
  { id: 'solar', label: 'Solar', icon: 'sun' },
  { id: 'integrations', label: 'Integrations', short: 'Setup', icon: 'plug2' },
  { id: 'activity', label: 'Activity', icon: 'list' },
];

interface Toast { id: number; msg: string; kind: 'ok' | 'error' }

type Theme = 'system' | 'light' | 'dark';
const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON: Record<Theme, string> = { system: 'monitor', light: 'sun', dark: 'moon' };
const THEME_LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** System follows the device; Light/Dark override it. Saved per browser (applied early by index.html). */
function useTheme() {
  const [theme, setTheme] = useStored<Theme>('theme', 'system');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1115' : '#f4f5f7');
  }, [theme]);
  return [theme, () => setTheme((t) => THEME_NEXT[t])] as const;
}

export default function App() {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [theme, cycleTheme] = useTheme();
  const [access, setAccess] = useState<AccessStatus | 'loading' | 'error'>('loading');
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('tab') as Tab) || 'home'; } catch { return 'home'; }
  });
  const [devices, setDevices] = useState<Device[]>([]);
  const [status, setStatus] = useState<Partial<Record<ProviderId, IntegrationStatus>>>({});
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [layout, setLayout] = useState<HomeLayout>({ rooms: [], order: {} });
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem('tab', t); } catch { /* storage unavailable */ }
  };

  useEffect(() => backend.onAuth(setUser), []);

  const checkAccess = useCallback(() => {
    setAccess('loading');
    backend.accessStatus().then(setAccess, () => setAccess('error'));
  }, []);
  useEffect(() => { if (user) checkAccess(); }, [user, checkAccess]);

  const member = !!user && access === 'member';
  useEffect(() => {
    if (!member) return;
    const unsubs = [
      backend.subscribeDevices(setDevices, (e) => notify(e.message, 'error')),
      backend.subscribeStatus(setStatus),
      backend.subscribeEvents(setEvents),
      backend.subscribeLayout(setLayout),
    ];
    return () => unsubs.forEach((u) => u());
  }, [member, notify]);

  // Returning from an OAuth sign-in: ?integration=volvo&result=ok
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const provider = q.get('integration') as ProviderId | null;
    if (!provider) return;
    const name = providerMeta(provider)?.name ?? provider;
    if (q.get('result') === 'ok') notify(`${name} connected.`);
    else notify(`${name}: ${q.get('message') ?? 'connection failed'}`, 'error');
    go('integrations');
    window.history.replaceState(null, '', window.location.pathname);
  }, [notify]);

  const run: Run = useCallback(async (device, action, value) => {
    setPending((p) => new Set(p).add(device.id));
    try {
      await backend.sendCommand(device.id, action, value);
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(device.id); return n; });
    }
  }, [notify]);

  const onLayout = useCallback((next: HomeLayout) => {
    setLayout(next); // show the new order immediately
    backend.saveLayout(next).catch((e) => notify(`Could not save the layout: ${e.message}`, 'error'));
  }, [notify]);

  const onPrefs = useCallback((id: string, prefs: DevicePrefs) => {
    backend.updatePrefs(id, prefs).catch((e) => notify(e.message, 'error'));
  }, [notify]);

  const syncAll = async () => {
    setSyncing(true);
    try {
      const results = await backend.sync();
      const failed = results.filter((r) => r.error);
      if (failed.length) notify(failed.map((r) => `${providerMeta(r.provider).name}: ${r.error}`).join('\n'), 'error');
      else notify('All integrations synced.');
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  if (user === undefined) return <div className="gate"><p>Loading…</p></div>;
  if (!member) return <Gate backend={backend} user={user} access={access} onClaimed={checkAccess} />;

  const vehicles = devices.filter((d) => d.type === 'vehicle' && !d.stale);
  const chargers = devices.filter((d) => d.type === 'charger' && !d.stale);
  const stations = devices.filter((d) => d.type === 'solar' && !d.stale);
  const errors = Object.values(status).filter((s) => s?.lastError).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="home" /></span>
          <span className="brand-name">Smart Home</span>
          {backend.mode === 'demo' && <span className="badge info">Demo</span>}
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'selected' : ''}`} aria-current={tab === t.id ? 'page' : undefined} aria-label={t.label} title={t.label} onClick={() => go(t.id)}>
              <Icon name={t.icon as 'home'} size={18} />
              <span className={t.short ? 'label-long' : undefined}>{t.label}</span>
              {t.short && <span className="label-short">{t.short}</span>}
              {t.id === 'integrations' && errors > 0 && <span className="pip" aria-label={`${errors} with errors`} />}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button className="btn icon theme-btn" onClick={cycleTheme}
            aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[THEME_NEXT[theme]]}`} title={`Theme: ${THEME_LABEL[theme]}`}>
            <Icon name={THEME_ICON[theme] as 'sun'} size={18} />
          </button>
          <button className={`btn icon ${syncing ? 'spin' : ''}`} onClick={syncAll} disabled={syncing} aria-label="Sync all devices" title="Sync all">
            <Icon name="refresh" size={18} />
          </button>
          {backend.mode === 'firebase' && (
            <button className="btn icon" onClick={() => backend.signOut()} aria-label="Sign out" title={`Sign out ${user?.email ?? ''}`}>
              <Icon name="logout" size={18} />
            </button>
          )}
        </div>
      </header>

      <main className="content">
        {tab === 'home' && <HomeView devices={devices} run={run} pending={pending} onPrefs={onPrefs} onConnect={() => go('integrations')} layout={layout} onLayout={onLayout} />}
        {tab === 'energy' && <EnergyView devices={devices} onConnect={() => go('integrations')} />}
        {tab === 'vehicle' && <VehicleView vehicles={vehicles} onConnect={() => go('integrations')} />}
        {tab === 'charger' && <ChargerView chargers={chargers} onConnect={() => go('integrations')} />}
        {tab === 'solar' && <SolarView stations={stations} onConnect={() => go('integrations')} />}
        {tab === 'integrations' && <IntegrationsView backend={backend} status={status} notify={notify} />}
        {tab === 'activity' && <ActivityView events={events} />}
      </main>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </div>
  );
}
