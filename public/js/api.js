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

async function requestJson(url, { timeoutMs = 45_000, method = 'GET', headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
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
  const url = `${base}/${encodeURIComponent(provider)}/${encodeURIComponent(accountNo)}${query}`;
  // A free server that was asleep needs up to ~50s to wake: wait for it, and if
  // the connection still drops once while waking, try one more time.
  const options = { timeoutMs: 75_000 };
  try {
    return (await requestJson(url, options)).account;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NETWORK') {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return (await requestJson(url, options)).account;
    }
    throw error;
  }
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

/** Public DESCO announcements (empty list when none or when the portal is unreachable). */
export async function fetchNotices() {
  try {
    const payload = await requestJson('/api/notices', { timeoutMs: 12_000 });
    return Array.isArray(payload.notices) ? payload.notices : [];
  } catch {
    return [];
  }
}

/** Ask the meter itself for its balance now (the portal allows only a few a day). */
export async function requestRealtime(provider, accountNo) {
  const url = `/api/meter/${encodeURIComponent(provider)}/${encodeURIComponent(accountNo)}/realtime`;
  return (await requestJson(url, { method: 'POST', headers: { 'X-Requested-With': 'PrepaidPro' }, timeoutMs: 60_000 })).live;
}
