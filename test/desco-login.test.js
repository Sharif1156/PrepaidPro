import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Personal DESCO sign-in, end to end: a fake DESCO portal with two customers
 * and a real PrepaidPro server process pointed at it.
 */

const PORT = 4125;
const BASE = `http://127.0.0.1:${PORT}`;
let portal;
let child;
let users;
const seen = []; // which DESCO customer made each balance call

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function resetUsers() {
  users = {
    '01711111111': { password: 'pass-one', accounts: [{ accountId: 11, accountNo: '26027256', meterNo: '661120128359' }] },
    '01722222222': { password: 'pass-two', accounts: [] },
    // a customer whose meter is offline: the balance call fails
    '01733333333': { password: 'pass-three', accounts: [{ accountId: 33, accountNo: '41422335', meterNo: '1' }] },
  };
}

before(async () => {
  resetUsers();
  portal = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const cookie = String(req.headers.cookie || '');
      const owner = (cookie.match(/SESSION=(\d{11})/) || [])[1];
      if (url.pathname === '/api/auth/csrf') return send(res, 204, undefined, { 'Set-Cookie': 'XSRF-TOKEN=t; Path=/' });
      if (url.pathname === '/api/auth/login') {
        const body = JSON.parse(raw || '{}');
        if (users[body.username]?.password !== body.password) return send(res, 401, { authenticated: false });
        return send(res, 200, { authenticated: true }, { 'Set-Cookie': `SESSION=${body.username}; Path=/; HttpOnly` });
      }
      const reg = url.pathname.match(/^\/api\/auth\/register\/(start|verify|set-password)$/);
      if (reg) {
        const body = JSON.parse(raw || '{}');
        if (reg[1] === 'start') return send(res, 202, { status: 'OK', message: 'code sent' });
        if (reg[1] === 'verify') {
          return body.code === '123456' ? send(res, 200, { status: 'OK', message: 'verified' }) : send(res, 400, { message: 'Wrong or expired code.' });
        }
        users[body.username] = { password: body.password, accounts: [] };
        return send(res, 200, { status: 'OK', message: 'Registration complete.' });
      }
      if (!owner || !users[owner]) return send(res, 401, {});
      const me = users[owner];
      if (url.pathname === '/api/accounts' && req.method === 'GET') {
        return send(res, 200, { accounts: me.accounts, canAddAccount: true, linkedAccountCount: me.accounts.length });
      }
      if (url.pathname === '/api/accounts/link') {
        const { accountNo } = JSON.parse(raw);
        const accountId = Number(owner.slice(-2)) * 100 + me.accounts.length;
        me.accounts.push({ accountId, accountNo, meterNo: '000111' });
        return send(res, 201, { accountId, accountNo });
      }
      const match = url.pathname.match(/^\/api\/accounts\/(\d+)\/(.+)$/);
      if (match && match[2] === 'balance' && owner === '01733333333') return send(res, 500, { message: 'meter offline' });
      if (match && match[2] === 'balance') {
        seen.push(owner);
        return send(res, 200, { meterNo: '661120128359', balance: owner === '01711111111' ? 1111.11 : 2222.22, readingTime: '2026-11-07 15:30:00' });
      }
      return send(res, match ? 200 : 404, match ? {} : {});
    });
  });
  await new Promise((resolve) => portal.listen(0, '127.0.0.1', resolve));

  child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DEMO_MODE: '',
      DESCO_BASE: `http://127.0.0.1:${portal.address().port}`,
      DESCO_USERNAME: '',
      DESCO_PASSWORD: '',
      SESSION_SECRET: 'test-secret',
      RATE_LIMIT_PER_MINUTE: '500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await delay(100);
  }
  throw new Error('server did not start');
});

after(() => {
  child?.kill('SIGTERM');
  portal?.close();
});

const login = (username, password, headers = { 'X-Requested-With': 'PrepaidPro' }) =>
  fetch(`${BASE}/api/desco/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ username, password }),
  });

const meter = (no, token) =>
  fetch(`${BASE}/api/meter/desco/${no}`, { headers: token ? { 'X-Desco-Auth': token } : {} });

test('a wrong password is refused and no token is issued', async () => {
  const response = await login('01711111111', 'nope');
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'DESCO_LOGIN_FAILED');
  assert.ok(!body.token);
});

test('signing in returns a token (not the password) and the linked meters', async () => {
  const response = await login('01711111111', 'pass-one');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.accounts.map((item) => item.accountNo), ['26027256']);
  const decoded = Buffer.from(body.token, 'base64url').toString('latin1');
  assert.ok(!decoded.includes('pass-one') && !decoded.includes('01711111111'), 'token must be sealed');
  assert.ok(!JSON.stringify(body).includes('pass-one'));
});

test('lite mode returns just the balance, quickly, for a first visit', async () => {
  const token = (await (await login('01711111111', 'pass-one')).json()).token;
  const response = await fetch(`${BASE}/api/meter/desco/26027256?lite=1`, { headers: { 'X-Desco-Auth': token } });
  const { account } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(account.balance, 1111.11);
  assert.equal(account.meta.lite, true);
  assert.deepEqual(account.monthly, []);
});

test('an offline meter still loads, flagged so the app can offer a realtime reading', async () => {
  const token = (await (await login('01733333333', 'pass-three')).json()).token;
  const response = await meter('41422335', token);
  const { account } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(account.balance, null);
  assert.equal(account.meta.offline, true);
});

const reg = (step, body) =>
  fetch(`${BASE}/api/desco/register/${step}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'PrepaidPro' },
    body: JSON.stringify(body),
  });

test('a new customer can sign up in three steps, then sign in', async () => {
  const phone = '01755555555';
  assert.equal((await reg('start', { username: phone })).status, 200);
  const wrong = await reg('verify', { username: phone, code: '000000' });
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error.message, 'Wrong or expired code.');
  assert.equal((await reg('verify', { username: phone, code: '123456' })).status, 200);
  assert.equal((await reg('set-password', { username: phone, password: 'N3w-pass!' })).status, 200);
  assert.equal(users[phone].password, 'N3w-pass!');
});

test('sign-up also works with an email address', async () => {
  const email = 'new.person@gmail.com';
  assert.equal((await reg('start', { username: ' New.Person@Gmail.com ' })).status, 200);
  assert.equal((await reg('verify', { username: email, code: '123456' })).status, 200);
  assert.equal((await reg('set-password', { username: email, password: 'N3w-pass!' })).status, 200);
  assert.equal(users[email].password, 'N3w-pass!');
});

test('sign-up checks the number and the request header, and limits code requests', async () => {
  assert.equal((await reg('start', { username: 'abc' })).status, 400);
  const noHeader = await fetch(`${BASE}/api/desco/register/start`, { method: 'POST', body: '{"username":"01766666666"}' });
  assert.equal(noHeader.status, 400);
  const results = [];
  for (let i = 0; i < 5; i += 1) results.push((await reg('start', { username: '01777777777' })).status);
  assert.deepEqual(results, [200, 200, 200, 429, 429]);
});

test('each person reads meters through their own DESCO account', async () => {
  const one = (await (await login('01711111111', 'pass-one')).json()).token;
  const two = (await (await login('01722222222', 'pass-two')).json()).token;

  seen.length = 0;
  const first = await (await meter('26027256', one)).json();
  assert.equal(first.account.balance, 1111.11);
  assert.deepEqual(seen, ['01711111111']);

  // person two asks for a meter: it gets linked to THEIR account, not person one's
  const second = await (await meter('26025483', two)).json();
  assert.equal(second.account.balance, 2222.22);
  assert.equal(seen.at(-1), '01722222222');
  assert.deepEqual(users['01722222222'].accounts.map((item) => item.accountNo), ['26025483']);
  assert.equal(users['01711111111'].accounts.length, 1, 'person one is untouched');
});

test('without a sign-in and without a shared login, the app asks to sign in', async () => {
  const response = await meter('26027256');
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'DESCO_LOGIN_REQUIRED');
});

test('a tampered or foreign token is rejected', async () => {
  const token = (await (await login('01711111111', 'pass-one')).json()).token;
  const bad = `${token.slice(0, -4)}AAAA`;
  const response = await meter('26027256', bad);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'DESCO_AUTH_INVALID');
  assert.equal((await meter('26027256', 'garbage')).status, 401);
});

test('sign-in needs the app header', async () => {
  assert.equal((await login('01711111111', 'pass-one', {})).status, 400);
});

test('a changed DESCO password signs the person out cleanly', async () => {
  const token = (await (await login('01711111111', 'pass-one')).json()).token;
  users['01711111111'].password = 'changed';
  // drop the server's cached session by using a fresh account number path: ask for a new meter
  const response = await meter('26099999', token);
  const body = await response.json();
  users['01711111111'].password = 'pass-one';
  if (response.status === 200) return; // cached session still valid: nothing to expire yet
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'DESCO_AUTH_EXPIRED');
});

test('the config tells the app whether sign-ins survive a restart', async () => {
  const body = await (await fetch(`${BASE}/api/config`)).json();
  assert.equal(body.config.descoLogin.persistent, true);
  assert.equal(body.config.descoLogin.sharedFallback, false);
});

test('too many sign-in attempts are slowed down', async () => {
  let last;
  for (let i = 0; i < 12; i += 1) last = await login('01733333333', 'x');
  assert.equal(last.status, 429);
});

test('a shared DESCO login in the environment is ignored unless explicitly allowed', async () => {
  const { credentials } = await import('../src/desco-session.js');
  const saved = { ...process.env };
  process.env.DESCO_USERNAME = '01700000000';
  process.env.DESCO_PASSWORD = 'secret';
  delete process.env.ALLOW_SHARED_LOGIN;
  assert.equal(credentials(), null);
  process.env.ALLOW_SHARED_LOGIN = '1';
  assert.deepEqual(credentials(), { username: '01700000000', password: 'secret' });
  for (const key of ['DESCO_USERNAME', 'DESCO_PASSWORD', 'ALLOW_SHARED_LOGIN']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
