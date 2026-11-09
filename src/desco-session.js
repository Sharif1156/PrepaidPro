/**
 * Logged-in access to the new DESCO prepaid portal.
 *
 * Since the portal update, balances are no longer public. The official site
 * signs a customer in (cookie session + XSRF token), links meters to that
 * customer account, and reads balances from /api/accounts/{id}/...
 *
 * Each DESCO account gets its own DescoClient (cookie jar, linked meters).
 * Requests made while a person is signed in run inside `runWithClient`, so the
 * rest of the code keeps calling `api()` and `accountIdFor()` and automatically
 * uses that person's own DESCO account (and its limits). Without a personal
 * sign-in, the optional shared login from DESCO_USERNAME / DESCO_PASSWORD is used.
 *
 * Nothing here ever logs or returns a password.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { AppError, accountNotFound } from './errors.js';
import { request } from './http.js';

export function descoBase() {
  return (process.env.DESCO_BASE || 'https://prepaid.desco.org.bd').replace(/\/+$/, '');
}

/**
 * The optional shared login from the server's environment. Off unless
 * ALLOW_SHARED_LOGIN=1: by default every visitor must use their own DESCO
 * account, so the owner's account never carries other people's traffic.
 */
export function credentials() {
  if (!['1', 'true', 'yes'].includes(String(process.env.ALLOW_SHARED_LOGIN || '').toLowerCase())) return null;
  const username = (process.env.DESCO_USERNAME || '').trim();
  const password = process.env.DESCO_PASSWORD || '';
  return username && password ? { username, password } : null;
}

export class DescoClient {
  constructor(creds) {
    this.creds = creds;
    this.jar = new Map();
    this.linkedIds = new Map(); // accountNo -> accountId
    this.loggedIn = false;
    this.loginPromise = null;
    this.lastUsed = Date.now();
  }

  absorb(response) {
    const lines =
      typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const line of lines) {
      const [pair, ...attributes] = line.split(';');
      const at = pair.indexOf('=');
      if (at < 1) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute));
      if (!value || expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  cookieHeader() {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async raw(method, path, { body, query, timeoutMs = 15_000 } = {}) {
    const url = new URL(`${descoBase()}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const headers = { Accept: 'application/json' };
    if (this.jar.size) headers.Cookie = this.cookieHeader();
    if (method !== 'GET') {
      const xsrf = this.jar.get('XSRF-TOKEN');
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
    this.absorb(response);
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, ok: response.ok, json };
  }

  async login() {
    if (!this.creds) {
      throw new AppError('DESCO_LOGIN_MISSING', 'No DESCO login is set up. Sign in with your DESCO account.', {
        status: 503,
        retryable: false,
      });
    }
    this.jar.clear();
    this.loggedIn = false;
    await this.raw('GET', '/api/auth/csrf');
    const result = await this.raw('POST', '/api/auth/login', { body: this.creds });
    if (!result.ok || result.json?.authenticated === false) {
      throw new AppError('DESCO_LOGIN_FAILED', 'DESCO login failed. The mobile number or password is wrong.', {
        status: 502,
        retryable: false,
        details: { upstreamStatus: result.status },
      });
    }
    if (result.json?.mustChangePassword) {
      throw new AppError(
        'DESCO_PASSWORD_CHANGE_REQUIRED',
        'DESCO asks for a new password. Sign in on the DESCO portal once and change it.',
        { status: 502, retryable: false },
      );
    }
    this.loggedIn = true;
  }

  async ensureSession() {
    if (this.loggedIn) return;
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  /** Authenticated call. Signs in first, and once more if the session has expired. */
  async api(path, options = {}) {
    this.lastUsed = Date.now();
    await this.ensureSession();
    let result = await this.raw(options.method || 'GET', path, options);
    if (result.status === 401 || result.status === 403) {
      this.loggedIn = false;
      await this.ensureSession();
      result = await this.raw(options.method || 'GET', path, options);
    }
    if (!result.ok) {
      throw new AppError('UPSTREAM_HTTP_ERROR', `Utility portal responded with HTTP ${result.status}.`, {
        status: result.status === 404 ? 404 : 502,
        retryable: result.status >= 500 || result.status === 429,
        details: {
          upstreamStatus: result.status,
          ...(result.json?.message ? { message: String(result.json.message).slice(0, 160) } : {}),
        },
      });
    }
    return result.json;
  }

  /** The portal's internal id for an account number; links the meter first if needed. */
  async accountIdFor(accountNo) {
    if (this.linkedIds.has(accountNo)) return this.linkedIds.get(accountNo);

    const list = await this.api('/api/accounts');
    const found = (list?.accounts || []).find((item) => String(item.accountNo) === accountNo);
    if (found?.accountId !== undefined) {
      this.linkedIds.set(accountNo, found.accountId);
      return found.accountId;
    }
    if (list && list.canAddAccount === false) {
      throw new AppError(
        'DESCO_LINK_LIMIT',
        `This DESCO account already has ${list.linkedAccountCount ?? 'the maximum number of'} meters linked. Unlink one on the DESCO portal first.`,
        { status: 507, retryable: false },
      );
    }
    try {
      const linked = await this.api('/api/accounts/link', { method: 'POST', body: { accountNo } });
      if (linked?.accountId === undefined) throw accountNotFound('DESCO');
      this.linkedIds.set(accountNo, linked.accountId);
      return linked.accountId;
    } catch (error) {
      if (error?.details?.upstreamStatus && [400, 404, 409, 422].includes(error.details.upstreamStatus)) {
        throw accountNotFound('DESCO');
      }
      throw error;
    }
  }
}

/* ------------------------ which client is "current"? ------------------------ */

const store = new AsyncLocalStorage();
let shared = null; // client for the server's own DESCO_USERNAME login
let sharedKey = '';

const fingerprint = (creds) => createHash('sha256').update(`${creds.username}\n${creds.password}`).digest('hex');

function sharedClient() {
  const creds = credentials();
  const key = creds ? fingerprint(creds) : '';
  if (!shared || sharedKey !== key) {
    shared = new DescoClient(creds);
    sharedKey = key;
  }
  return shared;
}

/** Run `fn` so that api() and accountIdFor() use this client. */
export function runWithClient(client, fn) {
  return store.run(client, fn);
}

/** True when this request runs for a person signed in with their own DESCO account. */
export function hasPersonalClient() {
  return Boolean(store.getStore());
}

export function currentClient() {
  return store.getStore() || sharedClient();
}

export const api = (path, options) => currentClient().api(path, options);
export const accountIdFor = (accountNo) => currentClient().accountIdFor(accountNo);

/* ---------------------------- signed-in people ---------------------------- */

const MAX_CLIENTS = 200;
const IDLE_MS = 30 * 60 * 1000;
const users = new Map(); // fingerprint -> client

function sweep() {
  const now = Date.now();
  for (const [key, client] of users) if (now - client.lastUsed > IDLE_MS) users.delete(key);
  while (users.size > MAX_CLIENTS) users.delete(users.keys().next().value);
}

/** The client for one person's own DESCO account (kept for 30 idle minutes). */
export function userClient(creds) {
  sweep();
  const key = fingerprint(creds);
  let client = users.get(key);
  if (!client) {
    client = new DescoClient({ username: creds.username, password: creds.password });
    users.set(key, client);
  }
  return client;
}

export function dropUserClient(creds) {
  users.delete(fingerprint(creds));
}

/** Sign in with a person's own DESCO account and return their linked meters. */
export async function verifyLogin(creds) {
  const client = userClient(creds);
  try {
    await client.login();
    const list = await client.api('/api/accounts');
    return (list?.accounts || []).map((item) => ({
      accountNo: String(item.accountNo),
      meterNo: item.meterNo ? String(item.meterNo) : null,
      status: item.status || null,
    }));
  } catch (error) {
    users.delete(fingerprint(creds));
    throw error;
  }
}

/** Forget every session (used by tests). */
export function resetSession() {
  shared = null;
  sharedKey = '';
  users.clear();
}
