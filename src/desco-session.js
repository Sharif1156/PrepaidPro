/**
 * Logged-in access to the new DESCO prepaid portal.
 *
 * Since the portal update, balances are no longer public. The official site
 * signs a customer in (cookie session + XSRF token), links meters to that
 * customer account, and reads balances from /api/accounts/{id}/...
 *
 * This module does the same with ONE DESCO account whose login is given in the
 * DESCO_USERNAME and DESCO_PASSWORD environment variables. Nothing here ever
 * logs or returns the credentials.
 */
import { AppError, accountNotFound } from './errors.js';
import { request } from './http.js';

export function descoBase() {
  return (process.env.DESCO_BASE || 'https://prepaid.desco.org.bd').replace(/\/+$/, '');
}

export function credentials() {
  const username = (process.env.DESCO_USERNAME || '').trim();
  const password = process.env.DESCO_PASSWORD || '';
  return username && password ? { username, password } : null;
}

const jar = new Map();
const linkedIds = new Map(); // accountNo -> accountId
let loggedIn = false;
let loginPromise = null;

export function resetSession() {
  jar.clear();
  linkedIds.clear();
  loggedIn = false;
  loginPromise = null;
}

function absorb(response) {
  const lines =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const line of lines) {
    const [pair, ...attributes] = line.split(';');
    const at = pair.indexOf('=');
    if (at < 1) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    const expired = attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute));
    if (!value || expired) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader() {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function raw(method, path, { body, query, timeoutMs = 15_000 } = {}) {
  const url = new URL(`${descoBase()}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers = { Accept: 'application/json' };
  if (jar.size) headers.Cookie = cookieHeader();
  if (method !== 'GET') {
    const xsrf = jar.get('XSRF-TOKEN');
    if (xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf);
    headers.Origin = descoBase();
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await request(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeoutMs,
  });
  absorb(response);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json };
}

async function login() {
  const creds = credentials();
  if (!creds) {
    throw new AppError('DESCO_LOGIN_MISSING', 'The server has no DESCO login configured.', {
      status: 503,
      retryable: false,
    });
  }
  jar.clear();
  loggedIn = false;
  await raw('GET', '/api/auth/csrf');
  const result = await raw('POST', '/api/auth/login', { body: creds });
  if (!result.ok || result.json?.authenticated === false) {
    throw new AppError(
      'DESCO_LOGIN_FAILED',
      'DESCO login failed. Check DESCO_USERNAME and DESCO_PASSWORD on the server.',
      { status: 502, retryable: false, details: { upstreamStatus: result.status } },
    );
  }
  if (result.json?.mustChangePassword) {
    throw new AppError(
      'DESCO_PASSWORD_CHANGE_REQUIRED',
      'DESCO asks for a new password. Sign in on the DESCO portal once, change it, then update DESCO_PASSWORD.',
      { status: 502, retryable: false },
    );
  }
  loggedIn = true;
}

async function ensureSession() {
  if (loggedIn) return;
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null;
    });
  }
  await loginPromise;
}

/** Authenticated call. Signs in first, and once more if the session has expired. */
export async function api(path, options = {}) {
  await ensureSession();
  let result = await raw(options.method || 'GET', path, options);
  if (result.status === 401 || result.status === 403) {
    loggedIn = false;
    await ensureSession();
    result = await raw(options.method || 'GET', path, options);
  }
  if (!result.ok) {
    throw new AppError('UPSTREAM_HTTP_ERROR', `Utility portal responded with HTTP ${result.status}.`, {
      status: result.status === 404 ? 404 : 502,
      retryable: result.status >= 500 || result.status === 429,
      details: { upstreamStatus: result.status, ...(result.json?.message ? { message: String(result.json.message).slice(0, 160) } : {}) },
    });
  }
  return result.json;
}

/** The portal's internal id for an account number; links the meter first if needed. */
export async function accountIdFor(accountNo) {
  if (linkedIds.has(accountNo)) return linkedIds.get(accountNo);

  const list = await api('/api/accounts');
  const found = (list?.accounts || []).find((item) => String(item.accountNo) === accountNo);
  if (found?.accountId !== undefined) {
    linkedIds.set(accountNo, found.accountId);
    return found.accountId;
  }
  if (list && list.canAddAccount === false) {
    throw new AppError(
      'DESCO_LINK_LIMIT',
      `The server's DESCO login already has ${list.linkedAccountCount ?? 'the maximum number of'} meters linked.`,
      { status: 507, retryable: false },
    );
  }
  try {
    const linked = await api('/api/accounts/link', { method: 'POST', body: { accountNo } });
    if (linked?.accountId === undefined) throw accountNotFound('DESCO');
    linkedIds.set(accountNo, linked.accountId);
    return linked.accountId;
  } catch (error) {
    if (error?.details?.upstreamStatus && [400, 404, 409, 422].includes(error.details.upstreamStatus)) {
      throw accountNotFound('DESCO');
    }
    throw error;
  }
}
