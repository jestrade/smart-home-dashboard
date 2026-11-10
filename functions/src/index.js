import dns from 'node:dns';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { db, FieldValue } from './lib/admin.js';
import { accessStatusFor, assertMember, claimDashboard } from './lib/access.js';
import { pkcePair, randomToken, requestToken, tokenPatch } from './lib/oauth.js';
import {
  ACTION_CAPABILITY,
  getProvider,
  loadConfig,
  runCommand,
  syncAll,
  syncProvider,
  writeStatus,
} from './lib/service.js';
import { providers } from './providers/index.js';
import { confirm, staticResponse, verifySignature } from './lib/smartapp.js';
import { authenticateBridge, hashToken, newBridgeToken, storeReport, storeResult, takeCommands } from './lib/bridge.js';
import { sanitize as sanitizeMotion } from './providers/motion.js';

// Prefer IPv4 for outbound calls: Tuya rejects Cloud Run's IPv6 addresses (error 1114).
dns.setDefaultResultOrder('ipv4first');

const REGION = 'us-central1';
setGlobalOptions({ region: REGION, maxInstances: 5 });

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function defaultRedirectUri() {
  const project = process.env.GCLOUD_PROJECT;
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return `http://127.0.0.1:5001/${project}/${REGION}/oauthCallback`;
  }
  return `https://${REGION}-${project}.cloudfunctions.net/oauthCallback`;
}

// ---------- access ----------

export const accessStatus = onCall(async (req) => ({ status: await accessStatusFor(req.auth) }));

export const claim = onCall(async (req) => ({ owner: await claimDashboard(req.auth) }));

// ---------- integrations ----------

export const saveIntegration = onCall(async (req) => {
  await assertMember(req.auth);
  const { provider, config } = req.data ?? {};
  const p = getProvider(provider);
  if (!config || typeof config !== 'object') throw new HttpsError('invalid-argument', 'config is required.');

  // Only known fields; blank values are ignored so saved secrets are not wiped by an empty input.
  const patch = {};
  for (const key of p.configFields) {
    const v = config[key];
    if (typeof v === 'string' && v.trim()) patch[key] = v.trim();
  }
  if (patch.baseUrl && !/^https?:\/\//.test(patch.baseUrl)) {
    throw new HttpsError('invalid-argument', 'URL must start with http:// or https://');
  }
  await db.doc(`integrations/${provider}`).set(patch, { merge: true });
  const cfg = await loadConfig(provider);
  await writeStatus(provider, cfg, { lastError: null });

  // Key-based providers can sync immediately; OAuth ones wait for Connect.
  if (!p.oauth) return syncProvider(provider);
  return { provider, saved: Object.keys(patch) };
});

export const disconnectIntegration = onCall(async (req) => {
  await assertMember(req.auth);
  const { provider } = req.data ?? {};
  getProvider(provider);
  await db.doc(`integrations/${provider}`).delete();
  const devices = await db.collection('devices').where('provider', '==', provider).get();
  const batch = db.batch();
  devices.forEach((d) => batch.delete(d.ref));
  batch.delete(db.doc(`integrationStatus/${provider}`));
  await batch.commit();
  return { provider, removedDevices: devices.size };
});

export const getAuthUrl = onCall(async (req) => {
  const email = await assertMember(req.auth);
  const { provider, appUrl } = req.data ?? {};
  const p = getProvider(provider);
  if (!p.oauth) throw new HttpsError('invalid-argument', `${provider} does not use OAuth.`);
  let app;
  try {
    app = new URL(appUrl);
    if (!['http:', 'https:'].includes(app.protocol)) throw new Error();
  } catch {
    throw new HttpsError('invalid-argument', 'appUrl must be an http(s) URL.');
  }
  const cfg = await loadConfig(provider);
  const missing = p.requiredConfig.filter((k) => !cfg[k]);
  if (missing.length) throw new HttpsError('failed-precondition', `Save ${missing.join(', ')} first.`);

  const state = randomToken();
  const { verifier, challenge } = pkcePair();
  const redirectUri = cfg.redirectUri || defaultRedirectUri();
  await db.doc(`oauthStates/${state}`).set({
    provider,
    verifier,
    redirectUri,
    appUrl: app.origin,
    email,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });
  return { url: p.oauth.authorizeUrl(cfg, { redirectUri, state, challenge }), redirectUri };
});

export const oauthCallback = onRequest(async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  if (typeof state !== 'string' || !state) {
    res.status(400).send('Missing state.');
    return;
  }
  const stateRef = db.doc(`oauthStates/${state}`);
  const snap = await stateRef.get();
  if (!snap.exists) {
    res.status(400).send('Unknown or already used sign-in link. Start again from the dashboard.');
    return;
  }
  const saved = snap.data();
  await stateRef.delete();
  const back = (result, message) => {
    const url = new URL(saved.appUrl);
    url.searchParams.set('integration', saved.provider);
    url.searchParams.set('result', result);
    if (message) url.searchParams.set('message', String(message).slice(0, 300));
    res.redirect(url.toString());
  };

  if (saved.expiresAt < Date.now()) return back('error', 'The sign-in took too long. Try again.');
  if (error) return back('error', errorDescription || error);
  if (typeof code !== 'string') return back('error', 'No authorization code returned.');

  try {
    const p = getProvider(saved.provider);
    const cfg = await loadConfig(saved.provider);
    const tok = await requestToken(p.oauth, cfg, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: saved.redirectUri,
      code_verifier: saved.verifier,
    });
    if (!tok.refresh_token && !cfg.refreshToken) {
      return back('error', 'Provider returned no refresh token, so the connection would expire within an hour.');
    }
    await db.doc(`integrations/${saved.provider}`).set(
      { ...tokenPatch(tok), connectedBy: saved.email, connectedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    const result = await syncProvider(saved.provider);
    return back(result.error ? 'error' : 'ok', result.error);
  } catch (e) {
    logger.error('oauth callback failed', e);
    return back('error', e.message);
  }
});

// ---------- devices ----------

export const syncDevices = onCall({ timeoutSeconds: 120 }, async (req) => {
  await assertMember(req.auth);
  const provider = req.data?.provider;
  return { results: provider ? [await syncProvider(provider)] : await syncAll() };
});

export const sendCommand = onCall({ timeoutSeconds: 60 }, async (req) => {
  const email = await assertMember(req.auth);
  const { deviceId, action, value } = req.data ?? {};
  if (typeof deviceId !== 'string' || !deviceId) throw new HttpsError('invalid-argument', 'deviceId is required.');
  if (!(action in ACTION_CAPABILITY)) throw new HttpsError('invalid-argument', `Unknown action "${action}".`);

  const checks = {
    setOn: () => typeof value === 'boolean',
    setBrightness: () => Number.isInteger(value) && value >= 0 && value <= 100,
    setTemperature: () => typeof value === 'number' && value >= 5 && value <= 35,
    setMode: () => typeof value === 'string' && value.length <= 32,
    cover: () => ['open', 'close', 'stop'].includes(value),
    setPosition: () => Number.isInteger(value) && value >= 0 && value <= 100,
  };
  if (checks[action] && !checks[action]()) throw new HttpsError('invalid-argument', `Invalid value for ${action}.`);

  return runCommand({ deviceId, action, value, email });
});

// ---------- home bridges (LAN-only devices such as Motion Blinds) ----------

const BRIDGE_SANITIZERS = { motion: sanitizeMotion };

/** Generates a new bridge token (shown once). Replaces any previous token. */
export const createBridgeToken = onCall(async (req) => {
  const email = await assertMember(req.auth);
  const { provider } = req.data ?? {};
  const p = getProvider(provider);
  if (!p.bridge) throw new HttpsError('invalid-argument', `${provider} does not use a home bridge.`);
  const token = newBridgeToken(provider);
  await db.doc(`integrations/${provider}`).set(
    { bridgeTokenHash: hashToken(token), bridgeTokenCreatedAt: FieldValue.serverTimestamp(), bridgeTokenCreatedBy: email },
    { merge: true },
  );
  await writeStatus(provider, await loadConfig(provider), { lastError: null });
  return { token, endpoint: `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/bridge/${provider}` };
});

/** The bridge's API: POST /<provider>/report, GET /<provider>/commands, POST /<provider>/result. */
export const bridge = onRequest({ timeoutSeconds: 30, maxInstances: 2 }, async (req, res) => {
  const [, provider, route] = (req.path ?? '').split('/');
  if (!BRIDGE_SANITIZERS[provider] || !['report', 'commands', 'result'].includes(route)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (!(await authenticateBridge(req, provider))) {
    res.status(401).json({ error: 'Invalid bridge token' });
    return;
  }
  try {
    if (route === 'report' && req.method === 'POST') {
      const count = await storeReport(provider, req.body, BRIDGE_SANITIZERS[provider]);
      await syncProvider(provider);
      res.json({ ok: true, devices: count });
    } else if (route === 'commands' && req.method === 'GET') {
      res.json({ commands: await takeCommands(provider) });
    } else if (route === 'result' && req.method === 'POST') {
      res.json({ ok: await storeResult(provider, req.body ?? {}) });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (e) {
    logger.error(`bridge ${provider}/${route} failed`, e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------- SmartThings SmartApp webhook ----------

export const smartthingsWebhook = onRequest({ timeoutSeconds: 30 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('POST only');
    return;
  }
  const body = req.body ?? {};
  const targetUrl = `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/smartthingsWebhook`;

  if (body.lifecycle === 'CONFIRMATION') {
    // Proven by fetching SmartThings' own confirmation URL; no secrets are involved.
    await confirm(body).catch((e) => logger.warn('smartapp confirmation failed', e));
    res.json({ targetUrl });
    return;
  }
  if (!(await verifySignature(req))) {
    logger.warn(`smartapp: rejected unsigned/invalid ${body.lifecycle} request`);
    res.status(401).send('Invalid signature');
    return;
  }

  const fixed = staticResponse(body);
  if (fixed) {
    res.json(fixed);
    return;
  }

  const ref = db.doc('integrations/smartthings');
  if (body.lifecycle === 'INSTALL' || body.lifecycle === 'UPDATE') {
    const d = body.installData ?? body.updateData ?? {};
    await ref.set(
      {
        accessToken: d.authToken,
        refreshToken: d.refreshToken,
        expiresAt: Date.now() + 4 * 60 * 1000,
        installedAppId: d.installedApp?.installedAppId ?? null,
        locationId: d.installedApp?.locationId ?? null,
        installedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // Sync now so devices appear right away (bounded so SmartThings gets its answer in time).
    await Promise.race([syncProvider('smartthings'), new Promise((r) => setTimeout(r, 15_000))]);
    res.json(body.lifecycle === 'INSTALL' ? { installData: {} } : { updateData: {} });
    return;
  }
  if (body.lifecycle === 'UNINSTALL') {
    await ref.set(
      { accessToken: FieldValue.delete(), refreshToken: FieldValue.delete(), expiresAt: FieldValue.delete(), installedAppId: FieldValue.delete() },
      { merge: true },
    );
    await writeStatus('smartthings', await loadConfig('smartthings'), { lastError: 'The automation was removed in the SmartThings app.' });
    res.json({ uninstallData: {} });
    return;
  }
  res.json({});
});

export const scheduledSync = onSchedule({ schedule: 'every 15 minutes', timeoutSeconds: 300 }, async () => {
  const results = await syncAll();
  logger.info('scheduled sync', results);
  // Clean up abandoned OAuth attempts.
  const stale = await db.collection('oauthStates').where('expiresAt', '<', Date.now()).get();
  await Promise.all(stale.docs.map((d) => d.ref.delete()));
});

