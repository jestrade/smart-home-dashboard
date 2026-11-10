import type {
  AccessStatus, Action, ActivityEvent, AppUser, Device, DevicePrefs, HomeLayout, IntegrationStatus, ProviderId,
} from '../types';

export type Unsubscribe = () => void;

export interface SyncResult {
  provider: ProviderId;
  count?: number;
  skipped?: boolean;
  error?: string;
}

/** Everything the UI needs. Implemented by Firebase (real) and an in-memory demo. */
export interface Backend {
  mode: 'firebase' | 'demo';
  onAuth(cb: (user: AppUser | null) => void): Unsubscribe;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  accessStatus(): Promise<AccessStatus>;
  claim(): Promise<void>;

  subscribeDevices(cb: (devices: Device[]) => void, onError: (e: Error) => void): Unsubscribe;
  subscribeStatus(cb: (status: Partial<Record<ProviderId, IntegrationStatus>>) => void): Unsubscribe;
  subscribeEvents(cb: (events: ActivityEvent[]) => void): Unsubscribe;

  sendCommand(deviceId: string, action: Action, value?: unknown): Promise<void>;
  updatePrefs(deviceId: string, prefs: DevicePrefs): Promise<void>;
  subscribeLayout(cb: (layout: HomeLayout) => void): Unsubscribe;
  saveLayout(layout: HomeLayout): Promise<void>;
  sync(provider?: ProviderId): Promise<SyncResult[]>;

  saveIntegration(provider: ProviderId, config: Record<string, string>): Promise<void>;
  connectUrl(provider: ProviderId): Promise<{ url: string; redirectUri: string }>;
  redirectUri(): string;
  disconnect(provider: ProviderId): Promise<void>;
}
