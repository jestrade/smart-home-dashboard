/** Error raised by a provider call. `status` 401 means the integration needs reconnecting. */
export class ProviderError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

/** fetch() wrapper that parses JSON and throws ProviderError with a useful message on failure. */
export async function fetchJson(url, { method = 'GET', headers = {}, body, form } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers } };
  if (form) {
    init.body = new URLSearchParams(form).toString();
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] ??= 'application/json';
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = (typeof data === 'string' ? data : JSON.stringify(data) ?? '').slice(0, 300);
    throw new ProviderError(`${method} ${new URL(url).pathname} failed (${res.status}): ${detail}`, res.status);
  }
  return data;
}
