import { AppError, upstreamUnreachable } from './errors.js';

const DEFAULT_TIMEOUT = 15_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * fetch() with a hard timeout and a helpful error when the network fails.
 * `details.reason` is used by the UI to explain sandboxed / offline servers.
 */
export async function request(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT, headers = {}, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...rest,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        ...headers,
      },
    });
    return response;
  } catch (error) {
    const reason =
      error?.name === 'AbortError'
        ? 'timeout'
        : /ENOTFOUND|EAI_AGAIN/.test(String(error?.cause?.code || error?.code || ''))
          ? 'dns'
          : 'network';
    throw upstreamUnreachable({
      reason,
      host: safeHost(url),
      hint:
        reason === 'timeout'
          ? 'The portal did not answer in time.'
          : 'The server hosting this app cannot open a connection to the utility portal.',
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('INVALID_UPSTREAM_RESPONSE', 'The utility portal returned a non-JSON response.', {
      status: 502,
      retryable: true,
      details: { status: response.status },
    });
  }
}

export async function requestJson(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: { Accept: 'application/json, text/plain, */*', ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new AppError('UPSTREAM_HTTP_ERROR', `Utility portal responded with HTTP ${response.status}.`, {
      status: 502,
      retryable: response.status >= 500 || response.status === 429,
      details: { upstreamStatus: response.status },
    });
  }
  return readJson(response);
}

export async function requestText(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...(options.headers || {}) },
  });
  return { response, text: await response.text() };
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

export const browserHeaders = USER_AGENT;
