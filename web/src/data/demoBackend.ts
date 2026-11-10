import type { Backend } from './backend';
import type { ActivityEvent, AppUser, Device, IntegrationStatus, ProviderId } from '../types';

// In-memory backend with sample devices so the UI can be explored without any accounts.

const now = () => new Date();
const d = (x: Omit<Device, 'online' | 'updatedAt'> & Partial<Device>): Device => ({ online: true, updatedAt: now(), ...x });

function seed(): Device[] {
  return [
    d({ id: 'tuya_lamp', provider: 'tuya', providerId: 'lamp', name: 'Floor lamp', type: 'light', state: { on: true, brightness: 70 }, capabilities: ['onoff', 'brightness'], prefs: { room: 'Living room', favorite: true } }),
    d({ id: 'tuya_strip', provider: 'tuya', providerId: 'strip', name: 'TV LED strip', type: 'light', state: { on: false, brightness: 40 }, capabilities: ['onoff', 'brightness'], prefs: { room: 'Living room' } }),
    d({ id: 'tuya_plug', provider: 'tuya', providerId: 'plug', name: 'Coffee machine', type: 'plug', state: { on: false }, capabilities: ['onoff'], prefs: { room: 'Kitchen', favorite: true } }),
    d({ id: 'tuya_curtain', provider: 'tuya', providerId: 'curtain', name: 'Curtains', type: 'cover', state: { position: 100 }, capabilities: ['cover'], prefs: { room: 'Bedroom' } }),
    d({ id: 'tuya_th', provider: 'tuya', providerId: 'th', name: 'Climate sensor', type: 'sensor', state: { temperature: 21.4, humidity: 48, battery: 82 }, capabilities: [], prefs: { room: 'Bedroom' } }),
    d({ id: 'tuya_fan', provider: 'tuya', providerId: 'fan', name: 'Ceiling fan', type: 'fan', state: { on: false }, capabilities: ['onoff'], prefs: { room: 'Bedroom' }, online: false }),
    d({ id: 'google_thermo', provider: 'google', providerId: 'thermo', name: 'Hallway thermostat', type: 'thermostat', suggestedRoom: 'Hallway', state: { temperature: 20.5, humidity: 45, mode: 'HEAT', availableModes: ['HEAT', 'COOL', 'HEATCOOL', 'OFF'], targetTemperature: 21, hvac: 'HEATING' }, capabilities: ['thermostat', 'mode'], prefs: { favorite: true } }),
    d({ id: 'google_door', provider: 'google', providerId: 'door', name: 'Front door', type: 'camera', suggestedRoom: 'Entrance', state: {}, capabilities: [] }),
    d({ id: 'homeassistant_lock', provider: 'homeassistant', providerId: 'lock.front_door', name: 'Front door lock', type: 'lock', state: { locked: true }, capabilities: ['lock'], prefs: { room: 'Entrance', favorite: true } }),
    d({ id: 'homeassistant_garage', provider: 'homeassistant', providerId: 'cover.garage', name: 'Garage door', type: 'cover', state: { open: false }, capabilities: ['cover'], prefs: { room: 'Garage' } }),
    d({ id: 'homeassistant_porch', provider: 'homeassistant', providerId: 'light.porch', name: 'Porch light', type: 'light', state: { on: false }, capabilities: ['onoff'], prefs: { room: 'Entrance' } }),
    d({ id: 'volvo_car', provider: 'volvo', providerId: 'YV1DEMO0000000001', name: 'Volvo 000001', type: 'vehicle', suggestedRoom: 'Garage', capabilities: [], state: {
      locked: true, doorsOpen: [], windowsOpen: ['sunroof'], odometerKm: 18342, batteryPercent: 76, rangeKm: 312, charging: 'IDLE', engineRunning: false,
      reportedAt: new Date(Date.now() - 12 * 60000).toISOString(),
      location: { lat: 57.7089, lon: 11.9746, heading: 184, at: new Date(Date.now() - 40 * 60000).toISOString() },
      doors: { frontLeftDoor: 'CLOSED', frontRightDoor: 'CLOSED', rearLeftDoor: 'CLOSED', rearRightDoor: 'CLOSED', hood: 'CLOSED', tailgate: 'CLOSED', tankLid: 'CLOSED' },
      windows: { frontLeftWindow: 'CLOSED', frontRightWindow: 'CLOSED', rearLeftWindow: 'CLOSED', rearRightWindow: 'CLOSED', sunroof: 'AJAR' },
      tyres: { frontLeft: 'NO_WARNING', frontRight: 'NO_WARNING', rearLeft: 'NO_WARNING', rearRight: 'NO_WARNING' },
      charge: { connection: 'DISCONNECTED', type: 'NONE', targetPercent: 90, currentLimitA: 16 },
      trip: { avgEnergyKwhPer100km: 19.4, avgSpeedKmh: 42, tripAutomaticKm: 12.3, tripManualKm: 1204.6, distanceToEmptyBatteryKm: 312 },
      health: { oil: 'NO_WARNING', coolant: 'NO_WARNING', brakeFluid: 'NO_WARNING' },
      warnings: [], lampChecks: 24, unavailable: ['details', 'diagnostics', 'fuel'],
    } }),
    d({ id: 'smartthings_ac', provider: 'smartthings', providerId: 'ac1', name: 'AC Samsung', type: 'thermostat', suggestedRoom: 'Bedroom', capabilities: ['onoff', 'mode', 'thermostat'], state: { on: true, temperature: 26.1, targetTemperature: 23.5, mode: 'cool', availableModes: ['cool', 'dry', 'wind', 'auto'] } }),
    d({ id: 'smartthings_tv_plug', provider: 'smartthings', providerId: 'plug1', name: 'TV plug', type: 'plug', suggestedRoom: 'Living room', capabilities: ['onoff'], state: { on: true, powerW: 86 } }),
    d({ id: 'imou_entrada', provider: 'imou', providerId: 'CAM1', name: 'Entrada', type: 'camera', model: 'IPC-A22EP', capabilities: ['onoff', 'snapshot'], prefs: { room: 'Entrance' }, state: { on: true, imageUrl: '/car/front.webp' } }),
    d({ id: 'solis_1', provider: 'solis', providerId: '1000000000001', name: 'Demo Home', type: 'solar', model: '8.8 kWp', suggestedRoom: 'Roof', capabilities: [], state: {
      statusLabel: 'Online', solarStatus: 'ok', powerKw: 4.25, capacityKwp: 8.8, todayKwh: 18.6, monthKwh: 212.4, yearKwh: 9800, totalKwh: 21300,
      income: { today: 13020, currency: 'COP' }, flow: { homeLoadKw: 1.2, gridKw: -3.05 }, todayGrid: { boughtKwh: 2.1, soldKwh: 9.4, homeKwh: 11.3 }, peakSunHours: 2.1,
      reportedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      curve: Array.from({ length: 41 }, (_, i) => { const m = 360 + i * 15; return { t: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, kw: Math.round(Math.max(0, 5.4 * Math.sin(Math.PI * i / 48) * (0.85 + 0.15 * Math.cos(i * 1.7))) * 100) / 100 }; }),
      days: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10), kwh: Math.round((22 + 9 * Math.sin(i * 0.9) + (i % 5) * 1.3) * 10) / 10 })),
      inverters: [{ sn: '1031130229100151', model: 'S6-GR1P5K', state: 'Online', kw: 4.25, todayKwh: 18.6, totalKwh: 21300 }],
    } }),
    d({ id: 'wallbox_1', provider: 'wallbox', providerId: '9988552', name: 'Pulsar Plus', type: 'charger', model: 'PLP1-M-2-4-9-002-F', suggestedRoom: 'Garage', capabilities: ['lock', 'charge', 'chargeCurrent'], state: {
      statusCode: 194, statusLabel: 'Charging', statusGroup: 'charging', on: true, locked: false, chargingPowerKw: 7.2, chargingSpeed: 32,
      maxChargingCurrent: 32, maxAvailableCurrent: 32, currency: '€', energyPrice: 0.24,
      session: { energyKwh: 6.4, greenEnergyKwh: 1.1, gridEnergyKwh: 5.3, rangeKm: 40, durationS: 3200, cost: 1.54, finished: false },
      ecoSmart: { enabled: false, mode: 'Eco', percentage: 100 }, powerBoost: false, autoLock: true, autoLockMinutes: 5,
      software: { current: '5.17.59', latest: '5.17.59', updateAvailable: false }, serial: '9988552', partNumber: 'PLP1-M-2-4-9-002-F',
      lastSync: new Date(Date.now() - 3 * 60000).toISOString().slice(0, 19).replace('T', ' '),
      sessions: [0, 1, 3, 5, 8].map((dd, i) => ({ start: Math.floor(Date.now() / 1000) - dd * 86400 - 3600 * (i + 2), durationS: 3600 * (2 + i), energyKwh: 9 + i * 3.5, cost: (9 + i * 3.5) * 0.24 })),
      last30: { sessions: 11, energyKwh: 168, cost: 40.32, durationS: 11 * 3 * 3600 },
    } }),
  ];
}

export function createDemoBackend(): Backend {
  let devices = seed();
  let events: ActivityEvent[] = [];
  const status: Partial<Record<ProviderId, IntegrationStatus>> = {
    tuya: { provider: 'tuya', configured: true, connected: true, lastSyncAt: now(), deviceCount: 6, fieldsSet: ['clientId', 'clientSecret'] },
    volvo: { provider: 'volvo', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['clientId', 'clientSecret', 'apiKey'] },
    google: { provider: 'google', configured: true, connected: true, lastSyncAt: now(), deviceCount: 2, fieldsSet: ['clientId', 'clientSecret', 'projectId'] },
    homeassistant: { provider: 'homeassistant', configured: true, connected: true, lastSyncAt: now(), deviceCount: 3, fieldsSet: ['baseUrl', 'token'] },
    smartthings: { provider: 'smartthings', configured: true, connected: true, lastSyncAt: now(), deviceCount: 2, fieldsSet: ['clientId', 'clientSecret'] },
    imou: { provider: 'imou', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['appId', 'appSecret'] },
    solis: { provider: 'solis', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['keyId', 'keySecret'] },
    wallbox: { provider: 'wallbox', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['email', 'password'] },
  };
  const deviceSubs = new Set<(x: Device[]) => void>();
  const statusSubs = new Set<(x: typeof status) => void>();
  const eventSubs = new Set<(x: ActivityEvent[]) => void>();
  const emit = () => {
    deviceSubs.forEach((cb) => cb(devices));
    statusSubs.forEach((cb) => cb({ ...status }));
    eventSubs.forEach((cb) => cb(events));
  };
  const user: AppUser = { email: 'demo@example.com', displayName: 'Demo user', photoURL: null };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const patch = (id: string, fn: (x: Device) => Device) => {
    devices = devices.map((x) => (x.id === id ? fn(x) : x));
  };

  return {
    mode: 'demo',
    onAuth: (cb) => {
      cb(user);
      return () => {};
    },
    signIn: async () => {},
    signOut: async () => {},
    accessStatus: async () => 'member',
    claim: async () => {},

    subscribeDevices: (cb) => {
      deviceSubs.add(cb);
      cb(devices);
      return () => deviceSubs.delete(cb);
    },
    subscribeStatus: (cb) => {
      statusSubs.add(cb);
      cb({ ...status });
      return () => statusSubs.delete(cb);
    },
    subscribeEvents: (cb) => {
      eventSubs.add(cb);
      cb(events);
      return () => eventSubs.delete(cb);
    },

    sendCommand: async (id, action, value) => {
      await wait(450);
      const dev = devices.find((x) => x.id === id)!;
      if (!dev.online) {
        events = [{ id: crypto.randomUUID(), at: now(), user: user.email!, deviceName: dev.prefs?.name || dev.name, provider: dev.provider, action, value, ok: false, error: 'Device is offline' }, ...events];
        emit();
        throw new Error(`${dev.name} is offline.`);
      }
      const s = { ...dev.state };
      if (action === 'setOn') s.on = Boolean(value);
      if (action === 'setBrightness') s.brightness = value as number;
      if (action === 'setTemperature') s.targetTemperature = value as number;
      if (action === 'setMode') s.mode = value as string;
      if (action === 'lock') s.locked = true;
      if (action === 'unlock') s.locked = false;
      if (action === 'climateStart') s.climatizing = true;
      if (action === 'climateStop') s.climatizing = false;
      if (action === 'pauseCharging') Object.assign(s, { statusGroup: 'paused', statusLabel: 'Paused', on: false });
      if (action === 'resumeCharging') Object.assign(s, { statusGroup: 'charging', statusLabel: 'Charging', on: true });
      if (action === 'setMaxCurrent') s.maxChargingCurrent = value as number;
      if (action === 'snapshot') Object.assign(s, { snapshotUrl: '/car/front-three-quarter.webp', snapshotAt: new Date().toISOString() });
      if (action === 'cover') {
        if (value === 'open') { s.open = true; if (s.position != null) s.position = 100; }
        if (value === 'close') { s.open = false; if (s.position != null) s.position = 0; }
      }
      patch(id, (x) => ({ ...x, state: s }));
      events = [{ id: crypto.randomUUID(), at: now(), user: user.email!, deviceName: dev.prefs?.name || dev.name, provider: dev.provider, action, value, ok: true }, ...events].slice(0, 50);
      emit();
    },
    updatePrefs: async (id, prefs) => {
      patch(id, (x) => ({ ...x, prefs }));
      emit();
    },
    sync: async (provider) => {
      await wait(700);
      const ids = provider ? [provider] : (Object.keys(status) as ProviderId[]);
      ids.forEach((p) => status[p] && (status[p] = { ...status[p]!, lastSyncAt: now() }));
      emit();
      return ids.map((p) => ({ provider: p, count: devices.filter((x) => x.provider === p).length }));
    },
    saveIntegration: async (provider, config) => {
      await wait(300);
      status[provider] = { provider, configured: true, connected: true, lastSyncAt: now(), deviceCount: 0, fieldsSet: Object.keys(config) };
      emit();
    },
    connectUrl: async () => {
      throw new Error('Connecting accounts is disabled in demo mode.');
    },
    redirectUri: () => 'https://us-central1-YOUR-PROJECT.cloudfunctions.net/oauthCallback',
    disconnect: async (provider) => {
      delete status[provider];
      devices = devices.filter((x) => x.provider !== provider);
      emit();
    },
  };
}
