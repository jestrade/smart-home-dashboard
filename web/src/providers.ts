import type { ProviderId } from './types';

export interface ConfigField {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
  help?: string;
}

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  blurb: string;
  color: string;
  oauth: boolean;
  /** Shows the SmartApp webhook URL to register (SmartThings). */
  webhook?: boolean;
  /** Connected through a home bridge program instead of credentials (Motion Blinds). */
  bridge?: boolean;
  /** Badge text when credentials are saved but the provider isn't linked yet. */
  pendingLabel?: string;
  docsUrl: string;
  steps: string[];
  fields: ConfigField[];
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'tuya',
    name: 'Tuya / Smart Life',
    blurb: 'Lights, plugs, switches, sensors and curtains paired in the Tuya or Smart Life app.',
    color: '#ff5a1f',
    oauth: false,
    docsUrl: 'https://developer.tuya.com/en/docs/iot/link-devices',
    steps: [
      'Create a Cloud project at iot.tuya.com (Smart Home, your data center).',
      'Devices → Link App Account → scan the QR code with the Tuya / Smart Life app.',
      'Copy the Access ID and Access Secret from the project overview.',
    ],
    fields: [
      { key: 'clientId', label: 'Access ID / Client ID' },
      { key: 'clientSecret', label: 'Access Secret', secret: true },
      {
        key: 'endpoint',
        label: 'API endpoint',
        optional: true,
        placeholder: 'https://openapi.tuyaus.com',
        help: 'tuyaus (Western America), tuyaeu (Europe), tuyacn (China), tuyain (India), openapi-ueaz.tuyaus.com (Eastern America).',
      },
      { key: 'uid', label: 'App account UID', optional: true, help: 'Only needed if no devices appear. Found under Devices → Link App Account.' },
    ],
  },
  {
    id: 'volvo',
    name: 'Volvo Cars',
    blurb: 'Read-only: battery, charging, range, doors, windows, tyres, warnings, trip statistics and location.',
    color: '#1c6bba',
    oauth: true,
    docsUrl: 'https://developer.volvocars.com/apis/connected-vehicle/v2/overview/',
    steps: [
      'Create an application at developer.volvocars.com and publish it to get production access for your own car.',
      'Copy the VCC API key, client ID and client secret.',
      'Add the redirect URI shown below to the application, then press Connect.',
    ],
    fields: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'clientSecret', label: 'Client secret', secret: true },
      { key: 'apiKey', label: 'VCC API key', secret: true },
      { key: 'vins', label: 'VIN', optional: true, placeholder: 'YV1…', help: 'Needed if your app lacks the vehicle list permission (conve:vehicle_relation). Separate several with commas. Found in the Volvo Cars app or on the windscreen.' },
      { key: 'scopes', label: 'Scopes', optional: true, help: 'Space separated. Leave blank for the default read-only set. Add conve:vehicle_relation (model, photo) or conve:diagnostics_workshop (service intervals) if your app has them.' },
      { key: 'redirectUri', label: 'Redirect URI override', optional: true },
    ],
  },
  {
    id: 'google',
    name: 'Google Nest',
    blurb: 'Nest thermostats, cameras and doorbells through Google Device Access.',
    color: '#34a853',
    oauth: true,
    docsUrl: 'https://developers.google.com/nest/device-access/get-started',
    steps: [
      'Create an OAuth client (Web application) in Google Cloud and enable the Smart Device Management API.',
      'Register for Device Access (one-time US$5 fee) and create a project with that OAuth client ID.',
      'Add the redirect URI shown below to the OAuth client, then press Connect.',
    ],
    fields: [
      { key: 'clientId', label: 'OAuth client ID' },
      { key: 'clientSecret', label: 'OAuth client secret', secret: true },
      { key: 'projectId', label: 'Device Access project ID' },
      { key: 'redirectUri', label: 'Redirect URI override', optional: true },
    ],
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    blurb: 'Everything else: Zigbee, Z-Wave, Matter, Hue, Shelly… through your Home Assistant.',
    color: '#18bcf2',
    oauth: false,
    docsUrl: 'https://developers.home-assistant.io/docs/api/rest/',
    steps: [
      'Make Home Assistant reachable from the internet (e.g. a Nabu Casa remote URL).',
      'Profile → Security → Long-lived access tokens → Create token.',
    ],
    fields: [
      { key: 'baseUrl', label: 'Base URL', placeholder: 'https://xxxx.ui.nabu.casa' },
      { key: 'token', label: 'Long-lived access token', secret: true },
      { key: 'include', label: 'Only include', optional: true, placeholder: 'light., lock.front_door', help: 'Comma-separated entity id prefixes. Blank = lights, switches, fans, climate, locks, covers and key sensors.' },
    ],
  },
];

PROVIDERS.push({
  id: 'smartthings',
  name: 'SmartThings',
  blurb: 'Samsung SmartThings: lights, switches, plugs, ACs, thermostats, locks, blinds and sensors, with your SmartThings rooms.',
  color: '#1428a0',
  oauth: false,
  webhook: true,
  pendingLabel: 'Install in app',
  docsUrl: 'https://developer.smartthings.com/docs/connected-services/create-a-smartapp',
  steps: [
    'Quick way: at account.smartthings.com/tokens, sign in with your Samsung account, Generate new token, tick Devices (all) and Locations (all), and paste the token below. SmartThings makes these tokens last 24 hours, so this is for trying it out.',
    'Lasting way: at developer.smartthings.com/workspace: New project → Automation for the SmartThings App → Register App → WebHook Endpoint, and paste the Target URL below.',
    'Select scopes r:devices:*, x:devices:* and r:locations:*. Copy the client ID and secret it shows (once), and save them here.',
    'Deploy the project to test. In the SmartThings app: enable Developer mode, then Automations → + → Discover → Home Dashboard, and allow access.',
  ],
  fields: [
    { key: 'token', label: 'Personal access token (lasts 24 h)', secret: true, optional: true },
    { key: 'clientId', label: 'SmartApp client ID', optional: true },
    { key: 'clientSecret', label: 'SmartApp client secret', secret: true, optional: true },
  ],
});

PROVIDERS.push({
  id: 'imou',
  name: 'Imou Life',
  blurb: 'Imou cameras: online status, privacy mode on/off and snapshots.',
  color: '#ff6a00',
  oauth: false,
  docsUrl: 'https://open.imoulife.com/book/en/http/develop.html',
  steps: [
    'Sign in to open.imoulife.com with the same account you use in the Imou Life app, and create an app (Console → My Apps).',
    'Copy the AppId and AppSecret. Pick the data center your account is in. Syncs as soon as you save.',
  ],
  fields: [
    { key: 'appId', label: 'AppId' },
    { key: 'appSecret', label: 'AppSecret', secret: true },
    { key: 'endpoint', label: 'Data center', optional: true, placeholder: 'https://openapi-or.easy4ip.com', help: 'openapi-or (Americas, default), openapi-fk (Europe), openapi-sg (Asia) — all .easy4ip.com.' },
  ],
});

PROVIDERS.push({
  id: 'motion',
  name: 'Motion Blinds',
  blurb: 'Motion Blinds / Coulisse motors through your Motion gateway: open, close, stop and position.',
  color: '#7a4dd8',
  oauth: false,
  bridge: true,
  pendingLabel: 'Waiting for bridge',
  docsUrl: 'https://github.com/jestrade/smart-home-dashboard/tree/main/bridge',
  steps: [
    'Motion gateways only work on your home network, so a small bridge program runs on an always-on computer at home (Mac, Raspberry Pi…).',
    'In the Motion Blinds app: Settings → About, tap 5 times, and copy the 16-character key. It stays on your home computer.',
    'Generate a bridge token below, put it and the key in bridge/config.json, and run: npm run motion (in the bridge folder).',
  ],
  fields: [],
});

PROVIDERS.push({
  id: 'solis',
  name: 'SolisCloud',
  blurb: 'Solis solar inverters (read-only): live production, today’s curve, daily history, home use, grid and battery.',
  color: '#f2a900',
  oauth: false,
  docsUrl: 'https://www.soliscloud.com/#/apiManage',
  steps: [
    'In SolisCloud: account menu → Basic Settings → API Management → Activate (approval can take a day or two).',
    'Copy the KeyId and KeySecret shown there. Syncs as soon as you save.',
  ],
  fields: [
    { key: 'keyId', label: 'KeyId' },
    { key: 'keySecret', label: 'KeySecret', secret: true },
    { key: 'endpoint', label: 'API URL', optional: true, placeholder: 'https://www.soliscloud.com:13333', help: 'Only change this if SolisCloud shows a different API URL on the API Management page.' },
  ],
});

PROVIDERS.push({
  id: 'wallbox',
  name: 'Wallbox',
  blurb: 'Wallbox chargers (Pulsar, Commander, Copper), read-only: live power, sessions, costs and configuration.',
  color: '#00b388',
  oauth: false,
  docsUrl: 'https://github.com/SKB-CGN/wallbox',
  steps: [
    'Use the email and password of your myWallbox account. Accounts created with Google or Apple sign-in do not work; set a password in the myWallbox app first.',
    'Chargers on the account are found automatically. Syncs as soon as you save.',
  ],
  fields: [
    { key: 'email', label: 'myWallbox email' },
    { key: 'password', label: 'myWallbox password', secret: true },
    { key: 'chargerIds', label: 'Charger ID', optional: true, help: 'Only if your charger is not found automatically. The serial number shown in the myWallbox app.' },
  ],
});

PROVIDERS.push({
  id: 'tesla',
  name: 'Tesla',
  blurb: 'Read-only: battery, charging, range, doors, windows, tyre warnings and location. Sleeping cars are not woken.',
  color: '#e82127',
  oauth: true,
  docsUrl: 'https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api',
  steps: [
    'Create an application at developer.tesla.com (Fleet API) and copy its client ID and client secret. Fleet API requests are billed by Tesla.',
    'Host your public key at https://<your-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem and call the partner register endpoint once in each region you use.',
    'Add the redirect URI shown below to the application, then press Connect.',
  ],
  fields: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'endpoint', label: 'Fleet API URL', optional: true, placeholder: 'https://fleet-api.prd.na.vn.cloud.tesla.com', help: 'North America and Europe use the default host; China uses https://fleet-api.prd.cn.vn.cloud.tesla.cn.' },
    { key: 'vins', label: 'VIN', optional: true, placeholder: '5YJ…', help: 'Only if you want a subset of the cars on the account. Separate several with commas.' },
    { key: 'scopes', label: 'Scopes', optional: true, help: 'Space separated. Leave blank for the default read-only set (openid offline_access user_data vehicle_device_data vehicle_location).' },
    { key: 'redirectUri', label: 'Redirect URI override', optional: true },
  ],
});

PROVIDERS.push({
  id: 'hyundai',
  name: 'Hyundai',
  blurb: 'Read-only, Europe only, through the Pleos Vehicle Data API (EU Data Act). Needs Pleos approval.',
  color: '#002c5f',
  oauth: false,
  docsUrl: 'https://document.pleos.ai/en/api-reference/vehicle-data-api/getting-started/api-access-request',
  steps: [
    'Request Vehicle Data API access in the Pleos portal for your car (Europe only).',
    'Copy the client ID and client secret Pleos gives you, and your car’s VIN. Syncs as soon as you save.',
  ],
  fields: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'vins', label: 'VIN', placeholder: 'KMH…', help: 'Separate several with commas. Found in the Bluelink app or on the windscreen.' },
    { key: 'endpoint', label: 'API URL', optional: true, help: 'Only change this if Pleos gives you a different Vehicle Data API URL.' },
    { key: 'tokenUrl', label: 'Token URL', optional: true, help: 'Only change this if Pleos gives you a different token URL.' },
  ],
});

PROVIDERS.push({
  id: 'volkswagen',
  name: 'Volkswagen',
  blurb: 'Unofficial / best-effort: read-only car status through a gateway you run or subscribe to (e.g. CarConnectivity). VW has no public owner API.',
  color: '#001e50',
  oauth: false,
  docsUrl: 'https://github.com/tillsteinbach/CarConnectivity',
  steps: [
    'Run or subscribe to a gateway that reads your car from Volkswagen and serves it over HTTPS with a bearer API key.',
    'The gateway must answer GET /vehicles with a list of { vin, name, model } and GET /vehicles/<vin>/status with the car’s battery, range, charging, odometer, lock, doors, windows and location.',
    'Enter its URL and API key. Syncs as soon as you save.',
  ],
  fields: [
    { key: 'endpoint', label: 'Gateway URL', placeholder: 'https://…' },
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'vins', label: 'VIN', optional: true, placeholder: 'WVW…', help: 'Only if the gateway has no vehicle list. Separate several with commas.' },
  ],
});

PROVIDERS.push({
  id: 'byd',
  name: 'BYD',
  blurb: 'Unofficial / best-effort: read-only car status through a gateway you run or subscribe to. BYD has no public owner API.',
  color: '#c8102e',
  oauth: false,
  docsUrl: 'https://github.com/jestrade/smart-home-dashboard#set-up-for-real',
  steps: [
    'Run or subscribe to a gateway that reads your car from BYD and serves it over HTTPS with a bearer API key.',
    'The gateway must answer GET /vehicles with a list of { vin, name, model } and GET /vehicles/<vin>/status with the car’s battery, range, charging, odometer, lock, doors, windows and location.',
    'Enter its URL and API key. Syncs as soon as you save.',
  ],
  fields: [
    { key: 'endpoint', label: 'Gateway URL', placeholder: 'https://…' },
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'vins', label: 'VIN', optional: true, placeholder: 'LGX…', help: 'Only if the gateway has no vehicle list. Separate several with commas.' },
  ],
});

PROVIDERS.push({
  id: 'huawei',
  name: 'Huawei FusionSolar',
  blurb: 'Huawei solar inverters (read-only): live production, today’s and lifetime energy, inverters.',
  color: '#c7000b',
  oauth: false,
  docsUrl: 'https://support.huawei.com/enterprise/en/doc/EDOC1100261860',
  steps: [
    'Ask the FusionSolar company admin to create a Northbound API user: System → Company Management → Northbound Management. This is not your normal FusionSolar login.',
    'Copy the API user name and system code. Set the host to your region if it is not eu5.',
    'Huawei allows only one API session at a time: a new login can sign out another API tool (for example an installer’s). Syncs as soon as you save.',
  ],
  fields: [
    { key: 'userName', label: 'API user name' },
    { key: 'systemCode', label: 'System code', secret: true },
    { key: 'endpoint', label: 'Host', optional: true, placeholder: 'https://eu5.fusionsolar.huawei.com', help: 'The FusionSolar host for your region, e.g. https://intl.fusionsolar.huawei.com or https://eu5.fusionsolar.huawei.com.' },
  ],
});

PROVIDERS.push({
  id: 'solaredge',
  name: 'SolarEdge',
  blurb: 'SolarEdge sites (read-only): live production, today, month, year and lifetime energy.',
  color: '#e4002b',
  oauth: false,
  docsUrl: 'https://knowledge-center.solaredge.com/sites/kc/files/se_monitoring_api.pdf',
  steps: [
    'In the SolarEdge monitoring portal: Admin → Site Access → API access. Accept the terms and copy the API key.',
    'Site ID is optional: leave it blank to show every site the key can see. Syncs as soon as you save.',
  ],
  fields: [
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'siteId', label: 'Site ID', optional: true, help: 'Only needed to show one site when the key covers several.' },
  ],
});

PROVIDERS.push({
  id: 'enphase',
  name: 'Enphase Enlighten',
  blurb: 'Enphase systems (read-only): live production, today’s and lifetime energy, system status.',
  color: '#f37321',
  oauth: true,
  docsUrl: 'https://developer-v4.enphase.com/docs/quickstart.html',
  steps: [
    'Create an application at developer-v4.enphase.com and copy its API key, client ID and client secret.',
    'Add the redirect URI shown below to the application, then press Connect and sign in with your Enlighten account.',
  ],
  fields: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'systemId', label: 'System ID', optional: true, help: 'Only needed to show one system when the account has several.' },
    { key: 'pollMinutes', label: 'Poll every (minutes)', optional: true, placeholder: '60', help: 'Minimum time between Enphase calls. The free Watt plan has a small monthly quota; 60 minutes keeps one system within it.' },
    { key: 'redirectUri', label: 'Redirect URI override', optional: true },
  ],
});

PROVIDERS.push({
  id: 'growatt',
  name: 'Growatt',
  blurb: 'Growatt plants (read-only): live production, today, month, year and lifetime energy.',
  color: '#00a0e9',
  oauth: false,
  docsUrl: 'https://www.showdoc.com.cn/262556420217021/0',
  steps: [
    'Get an API token from your Growatt OSS / ShineServer account (or ask your installer to issue one).',
    'Use the endpoint for your region if it is not the global one. Syncs as soon as you save.',
  ],
  fields: [
    { key: 'token', label: 'API token', secret: true },
    { key: 'endpoint', label: 'API URL', optional: true, placeholder: 'https://openapi.growatt.com', help: 'Regional servers: https://openapi-us.growatt.com, https://openapi-au.growatt.com, https://openapi-cn.growatt.com.' },
  ],
});

export const providerMeta = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;
