# Smart Home Dashboard

One dashboard for Tuya / Smart Life devices, your Volvo, Google Nest, and anything else via Home Assistant.
React + Vite frontend, Firebase Auth + Firestore + Cloud Functions backend.

```
web/          React app (Home, Car, Integrations, Activity tabs)
functions/    Cloud Functions: provider integrations, sync, commands, OAuth
firestore.rules
```

## How it works

```
Browser ──callable──▶ Cloud Functions ──▶ Tuya / Volvo / Google SDM / Home Assistant APIs
   ▲                       │
   └──── live snapshot ─── Firestore (devices, integrationStatus, events)
```

- **Credentials never reach the browser.** API keys and OAuth tokens live in `integrations/*`, which
  Firestore rules make server-only. You enter them once on the Integrations tab.
- Devices from every provider are normalized into `devices/{provider_id}` with a common `state` and
  `capabilities` list, so the UI doesn't care where a device came from.
- Commands (`sendCommand`) go through Functions, update the device doc and append to `events`.
- `scheduledSync` refreshes all providers every 15 minutes; the ↻ button syncs on demand.
- Access is an email allowlist in `config/access`. The first person to sign in claims the dashboard;
  add other household members to the `emails` array in the Firestore console.

## Try it without any accounts

```bash
npm run setup
npm run demo
```
Open http://localhost:5173. Demo mode uses sample devices in memory.

## Set up for real

1. **Firebase project** (Blaze plan is required for Cloud Functions and outbound API calls).
   - Create a project, add a Web app, enable **Authentication → Google** and **Firestore**.
   - Put the project ID in `.firebaserc`.
   - Copy `web/.env.example` to `web/.env.local` and fill in the web app config.
2. **Deploy:** `firebase deploy` (builds the web app, deploys hosting, rules and functions).
3. Open the hosted URL, sign in with Google, and **Claim dashboard**.
4. On **Integrations**, set up each provider:

| Provider | What you need | Notes |
| --- | --- | --- |
| Tuya / Smart Life | Cloud project at iot.tuya.com with your app account linked; Access ID + Secret | Pick the endpoint for your data center. Syncs immediately on save. |
| Volvo | App at developer.volvocars.com: client ID, secret, VCC API key | Register the redirect URI shown in the card, then **Connect**. |
| Google Nest | Google Cloud OAuth client + Device Access project (US$5 one-time) | Only Nest thermostats/cameras/doorbells are available via Google's cloud API. |
| Home Assistant | Public URL + long-lived token | The bridge for everything else (Zigbee, Z-Wave, Matter, Hue, Shelly…). |

The OAuth redirect URI is `https://us-central1-<project-id>.cloudfunctions.net/oauthCallback`.

### Local development against emulators

```bash
npm run emulators            # auth, firestore, functions (needs Java)
# in web/.env.local: VITE_USE_EMULATORS=true
npm run dev
```

## Adding another integration

Create `functions/src/providers/<name>.js` exporting `{ id, requiredConfig, configFields, listDevices(cfg, ctx), command(cfg, device, action, value, ctx) }`
(plus `oauth` if it uses OAuth), register it in `providers/index.js`, and add its form to `web/src/providers.ts`.
`listDevices` returns normalized devices: `{ providerId, name, type, online, state, capabilities, meta }`.

## Security notes

- Unlocking the car or a door asks for confirmation in the UI; every command is logged in **Activity** with who sent it.
- Credentials are stored in Firestore (server-only by rules, encrypted at rest). For stricter setups, move them to
  Secret Manager (`defineSecret`) — each provider reads them from one `loadConfig()` call in `functions/src/lib/service.js`.
