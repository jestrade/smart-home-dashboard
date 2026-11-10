import crypto from 'node:crypto';
import { fetchJson, ProviderError } from './http.js';

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function pkcePair() {
  const verifier = randomToken(32);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Call an OAuth token endpoint. Some providers want client credentials as Basic auth, others in the form. */
export async function requestToken(oauth, cfg, form) {
  const headers = {};
  const body = { ...form };
  if (oauth.basicAuth) {
    headers.Authorization = 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  } else {
    body.client_id = cfg.clientId;
    body.client_secret = cfg.clientSecret;
  }
  return fetchJson(oauth.tokenUrl, { method: 'POST', headers, form: body });
}

export function tokenPatch(tok) {
  return {
    accessToken: tok.access_token,
    expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
    ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
    // Scopes the provider actually granted (may be fewer than requested).
    ...(tok.scope ? { grantedScopes: tok.scope } : {}),
  };
}

/** Returns a valid access token, refreshing (and persisting) it when it is about to expire. */
export async function ensureAccessToken(oauth, cfg, ctx) {
  if (cfg.accessToken && cfg.expiresAt && cfg.expiresAt > Date.now() + 60_000) return cfg.accessToken;
  if (!cfg.refreshToken) throw new ProviderError('Not connected. Use Connect on the Integrations tab.', 401);
  let tok;
  try {
    tok = await requestToken(oauth, cfg, { grant_type: 'refresh_token', refresh_token: cfg.refreshToken });
  } catch (e) {
    // A rejected refresh token means the user has to sign in again.
    throw new ProviderError(`Token refresh failed, reconnect needed. ${e.message}`, 401);
  }
  const patch = tokenPatch(tok);
  await ctx.saveConfig(patch);
  Object.assign(cfg, patch);
  return cfg.accessToken;
}
