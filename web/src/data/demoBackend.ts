import type { Backend } from './backend';
import type { ActivityEvent, AppUser, EnergyDay, SecurityInfo, Device, HomeLayout, IntegrationStatus, ProviderId } from '../types';

// In-memory backend with sample devices so the UI can be explored without any accounts.

const now = () => new Date();
const ymd = (t: number) => new Date(t).toLocaleDateString('en-CA');
/** A day of 15-minute readings; k varies the day. */
function demoCurve(k: number) {
  return Array.from({ length: 96 }, (_, i) => {
    const m = i * 15;
    const cloud = 0.7 + 0.3 * Math.cos(k * 1.3 + i * 0.21);
    const sun = m < 330 || m > 1080 ? 0 : Math.round(Math.max(0, 5.4 * Math.sin((Math.PI * (m - 330)) / 750) * cloud) * 100) / 100;
    const home = Math.round((0.5 + (m > 900 && m < 1290 ? 2.6 : 0) + (m > 720 && m < 840 ? 1.8 : 0) + 0.3 * Math.sin(i + k)) * 100) / 100;
    return { t: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, kw: sun, homeKw: home, gridKw: Math.round((sun - home) * 100) / 100 };
  });
}
/** kWh per hour for the last 3 days, up to the current hour. */
const demoHours = (base: number) => {
  const out: { h: string; kwh: number }[] = [];
  for (let t = Date.now() - 3 * 86400000; t <= Date.now(); t += 3600000) {
    const d = new Date(t);
    const hour = d.getHours();
    out.push({ h: `${ymd(t)}T${String(hour).padStart(2, '0')}`, kwh: Math.round(base * (hour > 12 && hour < 23 ? 1 : 0.2) * (0.8 + 0.4 * Math.sin(t / 3.6e6)) * 100) / 100 });
  }
  return out;
};
const d = (x: Omit<Device, 'online' | 'updatedAt'> & Partial<Device>): Device => ({ online: true, updatedAt: now(), ...x });

function seed(): Device[] {
  return [
    d({ id: 'tuya_lamp', provider: 'tuya', providerId: 'lamp', name: 'Floor lamp', type: 'light', state: { on: true, brightness: 70 }, capabilities: ['onoff', 'brightness'], prefs: { room: 'Living room', favorite: true } }),
    d({ id: 'tuya_strip', provider: 'tuya', providerId: 'strip', name: 'TV LED strip', type: 'light', state: { on: false, brightness: 40 }, capabilities: ['onoff', 'brightness'], prefs: { room: 'Living room' } }),
    d({ id: 'tuya_plug', provider: 'tuya', providerId: 'plug', name: 'Coffee machine', type: 'plug', state: { on: false }, capabilities: ['onoff'], prefs: { room: 'Kitchen', favorite: true } }),
    d({ id: 'tuya_curtain', provider: 'tuya', providerId: 'curtain', name: 'Curtains', type: 'cover', state: { position: 100 }, capabilities: ['cover'], prefs: { room: 'Bedroom' } }),
    d({ id: 'tuya_th', provider: 'tuya', providerId: 'th', name: 'Climate sensor', type: 'sensor', state: { temperature: 21.4, humidity: 48, battery: 82 }, capabilities: [], prefs: { room: 'Bedroom' } }),
    d({ id: 'tuya_ir', provider: 'tuya', providerId: 'ir', name: 'Infrarrojo', type: 'other', state: {}, capabilities: [], prefs: { room: 'Living room' } }),
    d({ id: 'tuya_ac', provider: 'tuya', providerId: 'ac', name: 'Aire sala', type: 'other', state: {}, capabilities: [], prefs: { room: 'Living room' } }),
    d({ id: 'tuya_gw', provider: 'tuya', providerId: 'gw', name: 'GW06', type: 'other', state: {}, capabilities: [], prefs: { room: 'Hallway' } }),
    d({ id: 'tuya_valve', provider: 'tuya', providerId: 'valve', name: 'Válvula jardín', type: 'switch', state: { on: false }, capabilities: ['onoff'], prefs: { room: 'Jardín' } }),
    d({ id: 'tuya_purifier', provider: 'tuya', providerId: 'purifier', name: 'Purificador aire', type: 'plug', state: { on: true }, capabilities: ['onoff'], prefs: { room: 'Bedroom' } }),
    d({ id: 'imou_alarm', provider: 'imou', providerId: 'alarm', name: 'Alarma1', type: 'other', state: {}, capabilities: [], prefs: { room: 'Entrance' } }),
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
      trip: { avgEnergyKwhPer100km: 19.4, avgEnergyAutoKwhPer100km: 17.1, avgSpeedKmh: 42, avgSpeedAutoKmh: 35, tripAutomaticKm: 12.3, tripManualKm: 1204.6, distanceToEmptyBatteryKm: 312 },
      lights: { brakeLightLeftWarning: 'NO_WARNING', brakeLightRightWarning: 'NO_WARNING', brakeLightCenterWarning: 'NO_WARNING', fogLightFrontWarning: 'NO_WARNING', highBeamLeftWarning: 'NO_WARNING', highBeamRightWarning: 'NO_WARNING', turnIndicationFrontLeftWarning: 'FAILURE', turnIndicationFrontRightWarning: 'NO_WARNING', registrationPlateLightWarning: 'NO_WARNING' },
      health: { oil: 'NO_WARNING', coolant: 'NO_WARNING', brakeFluid: 'NO_WARNING' },
      warnings: [], lampChecks: 24, unavailable: ['details', 'diagnostics', 'fuel'],
    } }),
    d({ id: 'smartthings_ac', provider: 'smartthings', providerId: 'ac1', name: 'AC Samsung', type: 'thermostat', suggestedRoom: 'Bedroom', capabilities: ['onoff', 'mode', 'thermostat'], state: { on: true, powerW: 1180, energyTotalKwh: 412.6, todayKwh: 6.1, energyHours: demoHours(0.9), energyDays: Array.from({ length: 20 }, (_, i) => ({ day: new Date(Date.now() - (19 - i) * 86400000).toLocaleDateString('en-CA'), kwh: Math.round((5 + 3 * Math.sin(i)) * 10) / 10 })), temperature: 26.1, targetTemperature: 23.5, mode: 'cool', availableModes: ['cool', 'dry', 'wind', 'auto'] } }),
    d({ id: 'smartthings_tv_plug', provider: 'smartthings', providerId: 'plug1', name: 'TV plug', type: 'plug', suggestedRoom: 'Living room', capabilities: ['onoff'], state: { on: true, powerW: 86, energyEstimated: true, energyHours: demoHours(0.09), energyDays: Array.from({ length: 12 }, (_, i) => ({ day: new Date(Date.now() - (11 - i) * 86400000).toLocaleDateString('en-CA'), kwh: Math.round((0.6 + 0.3 * Math.cos(i)) * 100) / 100 })) } }),
    d({ id: 'imou_entrada', provider: 'imou', providerId: 'CAM1', name: 'Entrada', type: 'camera', model: 'IPC-A22EP', capabilities: ['onoff', 'snapshot', 'live'], prefs: { room: 'Entrance' }, state: { on: true, imageUrl: '/car/front.webp' } }),
    d({ id: 'solis_1', provider: 'solis', providerId: '1000000000001', name: 'Demo Solar', type: 'solar', model: '8.8 kWp', suggestedRoom: 'Roof', capabilities: [], state: {
      statusLabel: 'Online', solarStatus: 'ok', powerKw: 4.25, capacityKwp: 8.8, todayKwh: 18.6, monthKwh: 212.4, yearKwh: 9800, totalKwh: 21300,
      income: { today: 3.35, month: 38.23, year: 1764, total: 3834, currency: 'USD', pricePerKwh: 0.18 },
      flow: { homeLoadKw: 1.2, gridKw: 3.05 }, todayGrid: { boughtKwh: 4.1, soldKwh: 9.4, homeKwh: 13.3 }, peakSunHours: 2.1,
      periods: {
        day: { producedKwh: 18.6, consumedKwh: 13.3, importKwh: 4.1, exportKwh: 9.4, selfKwh: 9.2, income: 3.35, fullHours: 2.1 },
        month: { producedKwh: 212.4, consumedKwh: 301.5, importKwh: 160.2, exportKwh: 71.1, selfKwh: 141.3, income: 38.23, fullHours: 24.1 },
        year: { producedKwh: 9800, consumedKwh: 11200, importKwh: 4300, exportKwh: 2900, selfKwh: 6900, income: 1764.0, fullHours: 1113 },
        total: { producedKwh: 21300, consumedKwh: 30100, importKwh: 14200, exportKwh: 5400, selfKwh: 15900, income: 3834.0 },
      },
      weather: { day: 'Cloudy', night: 'Light Rain', minC: 26, maxC: 31, sunrise: '05:54', sunset: '17:33', humidity: 82, windMs: 5.7, windDir: 'SSW' },
      environment: { co2Kg: 21236, coalKg: 8520, trees: 11.8 },
      plant: { place: 'Demo City', tiltDeg: 30, azimuthDeg: 0, inverterKw: 5, since: '2023-11-30', days: 865, alarms: 0 },
      reportedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      curve: demoCurve(0),
      days: Array.from({ length: 30 }, (_, i) => {
        const made = Math.round((22 + 9 * Math.sin(i * 0.9) + (i % 5) * 1.3) * 10) / 10;
        const used = Math.round((30 + 8 * Math.cos(i * 0.7)) * 10) / 10;
        const sold = Math.round(made * 0.3 * 10) / 10;
        return { day: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10), kwh: made, producedKwh: made, consumedKwh: used, exportKwh: sold, selfKwh: Math.round((made - sold) * 10) / 10, importKwh: Math.round((used - made + sold) * 10) / 10, income: Math.round(made * 0.18 * 100) / 100 };
      }),
      months: Array.from({ length: 11 }, (_, i) => {
        const made = i === 3 ? 0 : Math.round(700 + 200 * Math.sin(i * 0.8));
        const used = i === 3 ? 0 : Math.round(850 + 150 * Math.cos(i * 0.6));
        return { month: `2026-${String(i + 1).padStart(2, '0')}`, producedKwh: made, consumedKwh: used, exportKwh: Math.round(made * 0.28), selfKwh: Math.round(made * 0.72), importKwh: Math.round(used - made * 0.72), income: Math.round(made * 0.18 * 100) / 100 };
      }),
      years: [['2023', 250, 470], ['2024', 3490, 7060], ['2025', 6500, 8510], ['2026', 9800, 11200]].map(([year, made, used]) => ({ year: String(year), producedKwh: Number(made), consumedKwh: Number(used), selfKwh: Math.round(Number(made) * 0.72), exportKwh: Math.round(Number(made) * 0.28), importKwh: Math.round(Number(used) - Number(made) * 0.72), income: Math.round(Number(made) * 0.18) })),
      inverters: [{ sn: '1031130229100151', model: 'S6-GR1P5K', state: 'Online', kw: 4.25, todayKwh: 18.6, totalKwh: 21300 }],
    } }),
    d({ id: 'huawei_1', provider: 'huawei', providerId: 'NE=33554432', name: 'Huawei Demo Plant', type: 'solar', model: '6 kWp', suggestedRoom: 'Roof', capabilities: [], state: {
      statusLabel: 'Healthy', solarStatus: 'ok', powerKw: 3.1, capacityKwp: 6, todayKwh: 14.2, monthKwh: 168.5, totalKwh: 12450,
      periods: { day: { producedKwh: 14.2 }, month: { producedKwh: 168.5 }, total: { producedKwh: 12450 } },
      reportedAt: new Date(Date.now() - 6 * 60000).toISOString(),
      curve: demoCurve(1).map(({ t, kw }) => ({ t, kw: Math.round(kw * 0.68 * 100) / 100 })),
      inverters: [{ sn: 'HV2150012345', model: 'SUN2000-6KTL-L1', state: 'Grid connected', kw: 3.1, todayKwh: 14.2, totalKwh: 12450 }],
    } }),
    d({ id: 'solaredge_1', provider: 'solaredge', providerId: '1234567', name: 'SolarEdge Demo Site', type: 'solar', model: '7.2 kWp', suggestedRoom: 'Roof', capabilities: [], state: {
      statusLabel: 'Active', solarStatus: 'ok', powerKw: 3.82, capacityKwp: 7.2, todayKwh: 16.4, monthKwh: 190.3, yearKwh: 8120, totalKwh: 30410,
      periods: { day: { producedKwh: 16.4 }, month: { producedKwh: 190.3 }, year: { producedKwh: 8120 }, total: { producedKwh: 30410 } },
      reportedAt: new Date(Date.now() - 12 * 60000).toISOString(),
    } }),
    d({ id: 'enphase_1', provider: 'enphase', providerId: '4567890', name: 'Enphase Demo System', type: 'solar', model: '5.4 kWp', suggestedRoom: 'Roof', capabilities: [], state: {
      statusLabel: 'Normal', solarStatus: 'ok', powerKw: 2.64, capacityKwp: 5.4, todayKwh: 11.8, totalKwh: 9875,
      periods: { day: { producedKwh: 11.8 }, total: { producedKwh: 9875 } },
      reportedAt: new Date(Date.now() - 20 * 60000).toISOString(),
    } }),
    d({ id: 'growatt_1', provider: 'growatt', providerId: '880011', name: 'Growatt Demo Plant', type: 'solar', model: '4 kWp', suggestedRoom: 'Roof', online: false, capabilities: [], state: {
      statusLabel: 'Offline', solarStatus: 'offline', powerKw: 0, capacityKwp: 4, todayKwh: 3.2, monthKwh: 74.6, yearKwh: 3950, totalKwh: 7310,
      periods: { day: { producedKwh: 3.2 }, month: { producedKwh: 74.6 }, year: { producedKwh: 3950 }, total: { producedKwh: 7310 } },
      reportedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
    } }),
    d({ id: 'motion_a1b2c3d4e5f60001', provider: 'motion', providerId: 'a1b2c3d4e5f60001', name: 'Motion blind 0001', type: 'cover', model: 'Roller blind', capabilities: ['cover', 'position'], prefs: { room: 'Living room', name: 'Living room blind' }, state: { position: 30, open: true, batteryVolts: 11.95 } }),
    d({ id: 'wallbox_1', provider: 'wallbox', providerId: '9988552', name: 'Pulsar Plus', type: 'charger', model: 'PLP1-M-2-4-9-002-F', suggestedRoom: 'Garage', capabilities: [], state: {
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
  let demoBlocked = ['185.220.101.4', '45.155.205.9'];
  let events: ActivityEvent[] = [];
  const status: Partial<Record<ProviderId, IntegrationStatus>> = {
    tuya: { provider: 'tuya', configured: true, connected: true, lastSyncAt: now(), deviceCount: 6, fieldsSet: ['clientId', 'clientSecret'] },
    volvo: { provider: 'volvo', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['clientId', 'clientSecret', 'apiKey'] },
    google: { provider: 'google', configured: true, connected: true, lastSyncAt: now(), deviceCount: 2, fieldsSet: ['clientId', 'clientSecret', 'projectId'] },
    homeassistant: { provider: 'homeassistant', configured: true, connected: true, lastSyncAt: now(), deviceCount: 3, fieldsSet: ['baseUrl', 'token'] },
    smartthings: { provider: 'smartthings', configured: true, connected: true, lastSyncAt: now(), deviceCount: 2, fieldsSet: ['clientId', 'clientSecret'] },
    imou: { provider: 'imou', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['appId', 'appSecret'] },
    motion: { provider: 'motion', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: [] },
    solis: { provider: 'solis', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['keyId', 'keySecret'] },
    huawei: { provider: 'huawei', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['userName', 'systemCode'] },
    solaredge: { provider: 'solaredge', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['apiKey'] },
    enphase: { provider: 'enphase', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['clientId', 'clientSecret', 'apiKey'] },
    growatt: { provider: 'growatt', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['token'] },
    wallbox: { provider: 'wallbox', configured: true, connected: true, lastSyncAt: now(), deviceCount: 1, fieldsSet: ['email', 'password'] },
  };
  const deviceSubs = new Set<(x: Device[]) => void>();
  const statusSubs = new Set<(x: typeof status) => void>();
  const eventSubs = new Set<(x: ActivityEvent[]) => void>();
  let layout: HomeLayout = { rooms: [], order: {} };
  const layoutSubs = new Set<(x: HomeLayout) => void>();
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
      if (action === 'snapshot') Object.assign(s, { snapshotUrl: '/car/front-three-quarter.webp', snapshotAt: new Date().toISOString() });
      if (action === 'live') Object.assign(s, { liveUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', liveAt: new Date().toISOString() });
      if (action === 'setPosition') { s.position = value as number; s.open = (value as number) > 0; }
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
    subscribeLayout: (cb) => {
      layoutSubs.add(cb);
      cb(layout);
      return () => layoutSubs.delete(cb);
    },
    saveLayout: async (next) => {
      layout = next;
      layoutSubs.forEach((cb) => cb(layout));
    },
    security: async (): Promise<SecurityInfo> => {
      await wait(200);
      const t = Date.now();
      return {
        blocked: demoBlocked.map((ip, i) => ({ ip, until: t + (20 - i * 6) * 3600000, reason: i ? 'rate-limit · bridge' : 'probe · bridge', at: t - (4 + i) * 3600000 })),
        events: [
          { id: 'e1', ip: '185.220.101.4', kind: 'probe', endpoint: 'bridge', path: '/wp-login.php', userAgent: 'Mozilla/5.0 zgrab/0.x', at: t - 4 * 3600000 },
          { id: 'e2', ip: '185.220.101.4', kind: 'blocked', endpoint: 'probe · bridge', at: t - 4 * 3600000 },
          { id: 'e3', ip: '45.155.205.9', kind: 'rate-limit', endpoint: 'bridge', path: '/motion/commands', userAgent: 'python-requests/2.31', at: t - 5 * 3600000 },
          { id: 'e4', ip: '102.89.33.18', kind: 'denied', endpoint: 'syncDevices', userAgent: 'curl/8.4', at: t - 26 * 3600000 },
        ].filter((e) => demoBlocked.includes(e.ip) || e.kind === 'denied'),
        appCheck: { verified: 0, missing: 0 },
        appCheckOn: false,
      };
    },
    unblockIp: async (ip) => {
      demoBlocked = demoBlocked.filter((x) => x !== ip);
    },
    energyDay: async (date): Promise<EnergyDay> => {
      await wait(300);
      const station = devices.find((x) => x.type === 'solar');
      const k = Math.round((Date.parse(date) - Date.parse(ymd(Date.now()))) / 86400000);
      const row = station?.state.days?.find((x) => x.day === date);
      return { date, today: ymd(Date.now()), stations: station && k > -60 ? [{ deviceId: station.id, curve: k === 0 ? station.state.curve ?? [] : demoCurve(k), balance: k === 0 ? station.state.periods?.day ?? null : row ?? null }] : [] };
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
    createBridgeToken: async (provider) => ({ token: `${provider}_demo-token-not-real`, endpoint: `https://us-central1-YOUR-PROJECT.cloudfunctions.net/bridge/${provider}` }),
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
