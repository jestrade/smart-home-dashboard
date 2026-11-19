# Smart Home Dashboard

React + Vite dashboard (`web/`) over Firebase Auth, Firestore and Cloud Functions (`functions/`) for Tuya, Volvo, Google Nest, Home Assistant and other providers. `bridge/` runs at home for LAN-only devices. See README.md for setup.

## Commands

Run from the repo root unless noted.

- Install: `npm run setup` (installs `web/` and `functions/`)
- Demo with in-memory devices, no accounts: `npm run demo` → http://localhost:5173
- Demo with the sample home: `npm --prefix web run demo:sample` → port 5175
- Web against local functions: `npm run local:functions` + `npm run local:web` → port 5174
- Emulators (auth, firestore, functions; needs Java): `npm run emulators`
- Build / type-check: `npm run build` (runs `tsc -b && vite build` in `web/`)
- There is no test suite or linter. Verify changes with `npm run build` and the demo in the browser.

## Layout

- `web/src/components/*View.tsx`: one view per tab (Home, Energy, Car, Charger, Solar, Integrations, Activity, Security)
- `web/src/providers.ts`: provider config forms shown on the Integrations tab
- `functions/src/providers/<name>.js`: one module per provider, registered in `providers/index.js`
- `functions/src/lib/`: shared server code (`service.js` loads provider config, `access.js` email allowlist, `guard.js` per-IP guard)
- `firestore.rules`: security rules; `integrations/*` is server-only
- `home/` (git-ignored) holds the user's real house plan and photos; `home.example/` is the public sample

## Rules

- Credentials never reach the browser. Provider secrets are read only in Functions through `loadConfig()` in `functions/src/lib/service.js`. Do not add client reads of `integrations/*` and do not loosen `firestore.rules` for it.
- Devices from every provider are normalized to `{ providerId, name, type, online, state, capabilities, meta }`. Keep new providers to that shape so the UI stays provider-agnostic.
- Adding a provider: create `functions/src/providers/<name>.js` exporting `{ id, requiredConfig, configFields, listDevices, command }` (plus `oauth` if needed), register it in `providers/index.js`, add its form to `web/src/providers.ts`.
- Commands that unlock the car or a door must keep the UI confirmation, and every command is logged to `events`.
- Never commit anything from `home/`, `.firebaserc`, `web/.env.local` or `functions/.env`.
- `functions/` is plain JavaScript (ES modules, Node 22); `web/` is TypeScript.
- Ask before running `firebase deploy` or anything that touches the real Firebase project.
