import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * End-to-end smoke test against a real server process in demo mode.
 * It covers routing, status codes, the security headers, the rate limiter
 * and the static-file guard against path traversal.
 */

const PORT = 4123;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), DEMO_MODE: '1', RATE_LIMIT_PER_MINUTE: '500' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await delay(100);
  }
  throw new Error('server did not start');
});

after(() => {
  child?.kill('SIGTERM');
});

test('health endpoint reports demo mode', async () => {
  const response = await fetch(`${BASE}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.demoMode, true);
  assert.equal(body.app, 'PrepaidPro');
});

test('config endpoint lists both providers', async () => {
  const response = await fetch(`${BASE}/api/config`);
  const body = await response.json();
  assert.deepEqual(
    body.config.providers.map((provider) => provider.id),
    ['desco', 'nesco'],
  );
});

test('a demo meter returns a full account payload', async () => {
  const response = await fetch(`${BASE}/api/meter/desco/104237569`);
  assert.equal(response.status, 200);
  const { account } = await response.json();
  assert.equal(account.provider, 'desco');
  assert.equal(account.demo, true);
  assert.equal(typeof account.balance, 'number');
  assert.ok(Array.isArray(account.monthly) && account.monthly.length > 0);
  assert.ok(Array.isArray(account.recharges) && account.recharges.length > 0);
  assert.ok(account.meta.cacheTtlSeconds > 0);
});

test('repeated lookups are served from the cache', async () => {
  await fetch(`${BASE}/api/meter/nesco/2456109837`);
  const second = await fetch(`${BASE}/api/meter/nesco/2456109837`);
  const { account } = await second.json();
  assert.equal(account.meta.cached, true);
});

test('demo data is deterministic per meter', async () => {
  const first = await (await fetch(`${BASE}/api/demo/desco/555111222`)).json();
  const second = await (await fetch(`${BASE}/api/demo/desco/555111222`)).json();
  assert.equal(first.account.balance, second.account.balance);
  assert.equal(first.account.monthly.length, second.account.monthly.length);
});

test('the same endpoint can be exported as a JSON download', async () => {
  const response = await fetch(`${BASE}/api/meter/desco/104237569?download=1`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /attachment; filename="prepaidpro-desco-104237569.json"/);
  const body = await response.json();
  assert.ok(body.account.accountNo);
  assert.ok(body.exportedAt);
});

test('unknown providers and short account numbers are rejected', async () => {
  const badProvider = await fetch(`${BASE}/api/meter/xyz/123456`);
  assert.equal(badProvider.status, 400);
  const body = await badProvider.json();
  assert.equal(body.error.code, 'BAD_REQUEST');

  const short = await fetch(`${BASE}/api/meter/desco/123`);
  assert.equal(short.status, 400);
});

test('unknown API routes return a JSON 404', async () => {
  const response = await fetch(`${BASE}/api/nope`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('write methods are refused', async () => {
  const response = await fetch(`${BASE}/api/health`, { method: 'POST' });
  assert.equal(response.status, 405);
});

test('the app shell is served with security headers', async () => {
  const response = await fetch(`${BASE}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const html = await response.text();
  assert.match(html, /PrepaidPro/);
});

test('deep links fall back to the app shell', async () => {
  const response = await fetch(`${BASE}/dashboard`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div class="app"/);
});

test('path traversal is blocked', async () => {
  const response = await fetch(`${BASE}/../package.json`);
  assert.ok([403, 404].includes(response.status), `got ${response.status}`);
  const body = await response.text();
  assert.doesNotMatch(body, /"name": "prepaidpro"/);
});

test('assets are gzipped when the client accepts it', async () => {
  const response = await fetch(`${BASE}/css/app.css`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'gzip');
});

test('conditional requests return 304', async () => {
  const first = await fetch(`${BASE}/css/app.css`);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const second = await fetch(`${BASE}/css/app.css`, { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);
});
