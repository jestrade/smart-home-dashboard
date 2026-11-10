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
    'At developer.smartthings.com/workspace: New project → Automation for the SmartThings App → Register App → WebHook Endpoint, and paste the Target URL below.',
    'Select scopes r:devices:*, x:devices:* and r:locations:*. Copy the client ID and secret it shows (once), and save them here.',
    'Deploy the project to test. In the SmartThings app: enable Developer mode, then Automations → + → Discover → Home Dashboard, and allow access.',
  ],
  fields: [
    { key: 'clientId', label: 'SmartApp client ID' },
    { key: 'clientSecret', label: 'SmartApp client secret', secret: true },
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

export const providerMeta = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;
