// SmartThings webhook SmartApp (registered in the Developer Workspace as an "Automation").
// Lifecycle docs: https://developer.smartthings.com/docs/connected-services/lifecycles
// Signature docs: https://developer.smartthings.com/docs/connected-services/hosting/webhook-smartapp
import crypto from 'node:crypto';
import { logger } from 'firebase-functions';

export const SMARTAPP_PERMISSIONS = ['r:devices:*', 'x:devices:*', 'r:locations:*'];
export const WEBHOOK_PATH = '/smartthingsWebhook';
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

const keyCache = new Map(); // keyId -> KeyObject

async function publicKey(keyId) {
  if (!/^\/[A-Za-z0-9/_.-]+$/.test(keyId)) throw new Error('bad keyId');
  if (keyCache.has(keyId)) return keyCache.get(keyId);
  const res = await fetch(`https://key.smartthings.com${keyId}`);
  if (!res.ok) throw new Error(`key fetch failed (${res.status})`);
  const key = new crypto.X509Certificate(await res.text()).publicKey;
  keyCache.set(keyId, key);
  return key;
}

/**
 * Verifies the HTTP Signature SmartThings puts on every webhook call.
 * `req` needs: method, rawBody (Buffer), get(header), and optionally originalUrl/url.
 */
export async function verifySignature(req) {
  const auth = req.get('authorization') ?? '';
  const m = /^Signature (.+)$/.exec(auth);
  const params = m ? Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]])) : {};
  const { keyId, signature } = params;
  const headers = (params.headers ?? 'date').split(' ');
  // Logs only non-secret metadata about why a request was rejected.
  const fail = (reason, extra = {}) => {
    logger.warn('smartapp signature check failed', {
      reason,
      authScheme: auth.split(' ')[0] || '(none)',
      keyId: keyId ?? null,
      signedHeaders: params.headers ?? null,
      algorithm: params.algorithm ?? null,
      url: req.url,
      originalUrl: req.originalUrl,
      date: req.get('date') ?? null,
      hasDigest: Boolean(req.get('digest')),
      ...extra,
    });
    return false;
  };
  if (!m) return fail('no Signature authorization header');
  if (!keyId || !signature) return fail('keyId or signature missing');

  const date = req.get('date');
  if (!date || Math.abs(Date.now() - Date.parse(date)) > MAX_CLOCK_SKEW_MS) return fail('date missing or too far off');

  if (headers.includes('digest')) {
    const expected = 'SHA-256=' + crypto.createHash('sha256').update(req.rawBody ?? '').digest('base64');
    const digest = req.get('digest');
    if (digest !== expected) {
      return fail('digest mismatch', { digestPrefix: String(digest).slice(0, 8), rawBodyBytes: req.rawBody?.length ?? null });
    }
  }

  let key;
  try {
    key = await publicKey(keyId);
  } catch (e) {
    return fail(`public key fetch failed: ${e.message}`);
  }
  // Firebase may strip the function name from req.url, so try the likely signed paths.
  const paths = [...new Set([WEBHOOK_PATH, req.originalUrl, req.url].filter(Boolean))];
  const sig = Buffer.from(signature, 'base64');
  const ok = paths.some((path) => {
    const signingString = headers
      .map((h) => (h === '(request-target)' ? `(request-target): ${req.method.toLowerCase()} ${path}` : `${h}: ${req.get(h) ?? ''}`))
      .join('\n');
    return crypto.verify('RSA-SHA256', Buffer.from(signingString), key, sig);
  });
  return ok || fail('RSA signature did not verify', { pathsTried: paths, keyType: key.asymmetricKeyType });
}

/** Responses that need no storage: PING and CONFIGURATION. Returns null for other lifecycles. */
export function staticResponse(body) {
  switch (body.lifecycle) {
    case 'PING':
      return { pingData: { challenge: body.pingData?.challenge } };
    case 'CONFIGURATION': {
      const phase = body.configurationData?.phase;
      if (phase === 'INITIALIZE') {
        return {
          configurationData: {
            initialize: {
              name: 'Home Dashboard',
              description: 'Shows and controls your SmartThings devices on your Home Dashboard',
              id: 'home-dashboard',
              permissions: SMARTAPP_PERMISSIONS,
              firstPageId: '1',
            },
          },
        };
      }
      if (phase === 'PAGE') {
        return {
          configurationData: {
            page: {
              pageId: '1',
              name: 'Home Dashboard',
              nextPageId: null,
              previousPageId: null,
              complete: true,
              sections: [
                {
                  name: 'Access',
                  settings: [
                    {
                      id: 'info',
                      name: 'Your devices will appear on your Home Dashboard',
                      description: 'The dashboard can read and control the devices in this location. Remove this automation at any time to revoke access.',
                      type: 'PARAGRAPH',
                    },
                  ],
                },
              ],
            },
          },
        };
      }
      return { configurationData: {} };
    }
    case 'EVENT':
      return { eventData: {} };
    case 'OAUTH_CALLBACK':
      return { oAuthCallbackData: {} };
    default:
      return null;
  }
}

/** CONFIRMATION: SmartThings asks us to GET a URL on its own API to prove we own the endpoint. */
export async function confirm(body) {
  const url = body.confirmationData?.confirmationUrl;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (!host.endsWith('.smartthings.com')) return false; // never fetch arbitrary URLs
  const res = await fetch(url);
  logger.info(`smartapp confirmation for app ${body.confirmationData?.appId}: ${res.status}`);
  return res.ok;
}
