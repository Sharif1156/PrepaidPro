/** Thin client for our own /api endpoints. */

export class ApiError extends Error {
  constructor(code, message, { status = 0, retryable = true, details = null } = {}) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

async function requestJson(url, { timeoutMs = 45_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new ApiError(
      navigator.onLine ? 'NETWORK' : 'OFFLINE',
      navigator.onLine
        ? 'The PrepaidPro server could not be reached.'
        : 'You are offline.',
      { retryable: true, details: { reason: error?.name } },
    );
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', 'The server returned an unexpected response.', {
      status: response.status,
    });
  }

  if (!response.ok || payload?.ok === false) {
    const error = payload?.error || {};
    throw new ApiError(error.code || 'HTTP_ERROR', error.message, {
      status: response.status,
      retryable: error.retryable !== false,
      details: error.details || null,
    });
  }
  return payload;
}

export async function fetchMeter(provider, accountNo, { refresh = false, demo = false } = {}) {
  const query = refresh ? '?refresh=1' : '';
  const base = demo ? '/api/demo' : '/api/meter';
  const payload = await requestJson(
    `${base}/${encodeURIComponent(provider)}/${encodeURIComponent(accountNo)}${query}`,
  );
  return payload.account;
}

export async function fetchServerConfig() {
  try {
    const payload = await requestJson('/api/config', { timeoutMs: 8000 });
    return payload.config;
  } catch {
    return null;
  }
}

export function downloadUrl(provider, accountNo) {
  return `/api/meter/${encodeURIComponent(provider)}/${encodeURIComponent(accountNo)}?download=1`;
}
