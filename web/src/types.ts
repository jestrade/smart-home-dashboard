export type ProviderId = 'tuya' | 'volvo' | 'google' | 'homeassistant' | 'wallbox' | 'smartthings' | 'imou' | 'solis' | 'motion';

export type DeviceType =
  | 'light' | 'switch' | 'plug' | 'fan' | 'thermostat' | 'sensor'
  | 'lock' | 'cover' | 'camera' | 'vehicle' | 'charger' | 'solar' | 'other';

export type Capability =
  | 'onoff' | 'brightness' | 'thermostat' | 'mode' | 'lock' | 'cover' | 'climate' | 'honkFlash'
  | 'snapshot' | 'position' | 'live';

export type Action =
  | 'setOn' | 'setBrightness' | 'setTemperature' | 'setMode'
  | 'lock' | 'unlock' | 'cover' | 'climateStart' | 'climateStop' | 'honkFlash'
  | 'snapshot' | 'setPosition' | 'live';

export interface DeviceState {
  on?: boolean;
  brightness?: number;
  temperature?: number | null;
  humidity?: number;
  targetTemperature?: number | null;
  mode?: string;
  availableModes?: string[];
  hvac?: string;
  locked?: boolean;
  open?: boolean;
  position?: number;
  battery?: number;
  batteryVolts?: number;
  rssi?: number;
  motion?: boolean;
  sleeping?: boolean;
  powerW?: number;
  snapshotUrl?: string;
  snapshotAt?: string;
  /** HLS address of the camera's live video, set by the "live" action. */
  liveUrl?: string;
  liveAt?: string;
  // vehicle
  doorsOpen?: string[];
  odometerKm?: number;
  fuelLiters?: number;
  batteryPercent?: number;
  rangeKm?: number;
  charging?: string;
  climatizing?: boolean;
  engineRunning?: boolean;
  location?: { lat: number; lon: number; heading?: number; at?: string };
  imageUrl?: string;
  doors?: Record<string, string>;
  windows?: Record<string, string>;
  windowsOpen?: string[];
  tyres?: Record<string, string>;
  charge?: {
    connection?: string; type?: string; powerStatus?: string; powerW?: number;
    currentLimitA?: number; targetPercent?: number; minutesToTarget?: number;
  };
  trip?: {
    avgEnergyKwhPer100km?: number; avgEnergyAutoKwhPer100km?: number; avgEnergySinceChargeKwhPer100km?: number;
    avgFuelLPer100km?: number; avgFuelAutoLPer100km?: number; avgSpeedKmh?: number; avgSpeedAutoKmh?: number;
    tripManualKm?: number; tripAutomaticKm?: number;
    distanceToEmptyBatteryKm?: number; distanceToEmptyTankKm?: number;
  };
  health?: { oil?: string; coolant?: string; brakeFluid?: string; washerFluid?: string; service?: string };
  service?: { distanceKm?: number; months?: number; engineHours?: number };
  warnings?: { name: string; value: string }[];
  lampChecks?: number;
  lights?: Record<string, string>;
  details?: { model?: string; modelYear?: number; fuelType?: string; color?: string; gearbox?: string; batteryCapacityKwh?: number };
  reportedAt?: string;
  unavailable?: string[];
  // charger
  statusCode?: number;
  statusLabel?: string;
  statusGroup?: 'charging' | 'ready' | 'locked' | 'paused' | 'waiting' | 'error' | 'idle';
  chargingPowerKw?: number;
  chargingSpeed?: number;
  maxChargingCurrent?: number;
  maxAvailableCurrent?: number;
  session?: { energyKwh?: number; greenEnergyKwh?: number; gridEnergyKwh?: number; rangeKm?: number; durationS?: number; cost?: number; finished?: boolean };
  stateOfCharge?: number;
  currency?: string;
  energyPrice?: number;
  ecoSmart?: { enabled?: boolean; mode?: string; percentage?: number };
  powerBoost?: boolean;
  autoLock?: boolean;
  autoLockMinutes?: number;
  software?: { current?: string; latest?: string; updateAvailable?: boolean };
  serial?: string;
  partNumber?: string;
  lastSync?: string;
  sessions?: { start: number; end?: number; energyKwh?: number; durationS?: number; cost?: number; rangeKm?: number }[];
  last30?: { sessions: number; energyKwh: number; cost: number; durationS: number };
  // energy metering (plugs, appliances)
  voltageV?: number;
  currentA?: number;
  /** Running energy counter reported by the device. */
  energyTotalKwh?: number;
  /** Energy per local day, worked out at each sync; estimated from power when the device has no counter. */
  energyDays?: { day: string; kwh: number }[];
  energyEstimated?: boolean;
  // solar
  solarStatus?: 'ok' | 'offline' | 'alarm';
  powerKw?: number;
  capacityKwp?: number;
  todayKwh?: number;
  monthKwh?: number;
  yearKwh?: number;
  totalKwh?: number;
  income?: { today?: number; month?: number; year?: number; total?: number; currency?: string; pricePerKwh?: number };
  /** Grid power: + sending to the grid, − buying from it. */
  flow?: { homeLoadKw?: number; gridKw?: number; batteryKw?: number; batteryPercent?: number };
  todayGrid?: { boughtKwh?: number; soldKwh?: number; homeKwh?: number };
  periods?: Partial<Record<'day' | 'month' | 'year' | 'total', EnergyBalance>>;
  peakSunHours?: number;
  weather?: { day?: string; night?: string; minC?: number; maxC?: number; sunrise?: string; sunset?: string; humidity?: number; windMs?: number; windDir?: string };
  environment?: { co2Kg?: number; coalKg?: number; trees?: number };
  plant?: { place?: string; tiltDeg?: number; azimuthDeg?: number; inverterKw?: number; since?: string; days?: number; alarms?: number };
  curve?: { t: string; kw: number; homeKw?: number; gridKw?: number }[];
  days?: ({ day: string; kwh: number } & EnergyBalance)[];
  months?: ({ month: string } & EnergyBalance)[];
  years?: ({ year: string } & EnergyBalance)[];
  inverters?: { sn: string; model?: string; state: string; kw?: number; todayKwh?: number; totalKwh?: number }[];
}

/** Energy over a period (kWh): made by the panels, used by the home, bought from and sold to the grid. */
export interface EnergyBalance {
  producedKwh?: number;
  consumedKwh?: number;
  importKwh?: number;
  exportKwh?: number;
  /** Solar energy used at home (produced − sold). */
  selfKwh?: number;
  /** What the solar energy was worth, at the plant's price per kWh. */
  income?: number;
  fullHours?: number;
}

export interface DevicePrefs {
  name?: string;
  room?: string;
  favorite?: boolean;
  hidden?: boolean;
}

export interface Device {
  id: string;
  provider: ProviderId;
  providerId: string;
  name: string;
  type: DeviceType;
  model?: string | null;
  online: boolean;
  stale?: boolean;
  state: DeviceState;
  capabilities: Capability[];
  suggestedRoom?: string | null;
  prefs?: DevicePrefs;
  updatedAt?: Date | null;
}

export interface IntegrationStatus {
  provider: ProviderId;
  configured: boolean;
  connected: boolean;
  fieldsSet?: string[];
  lastSyncAt?: Date | null;
  lastError?: string | null;
  deviceCount?: number;
}

export interface ActivityEvent {
  id: string;
  at: Date | null;
  user: string;
  deviceName: string;
  provider: ProviderId;
  action: Action;
  value?: unknown;
  ok: boolean;
  error?: string;
}

export interface AppUser {
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export type AccessStatus = 'member' | 'unclaimed' | 'denied';

/** Home page arrangement: room order and per-section card order (device ids). */
export interface HomeLayout {
  rooms: string[];
  order: Record<string, string[]>;
  /** Today widgets: forecast place, and which widgets show in each of the two columns, top to bottom. */
  widgets?: { weather?: WeatherLocation; columns?: { left?: string[]; right?: string[] }; items?: string[] };
  /** Order of the Home page's sections (ids: today, plan, summary, devices). */
  sections?: string[];
  /** Floor plan: dashboard room → plan zone id ('' = not on the plan), and dragged pin positions [x, z] in metres. */
  floorplan?: { zones?: Record<string, string>; pins?: Record<string, number[]> };
}

export interface WeatherLocation {
  name: string;
  lat: number;
  lon: number;
}

export const displayName = (d: Device) => d.prefs?.name || d.name;
export const roomOf = (d: Device) => d.prefs?.room || d.suggestedRoom || 'Unassigned';
