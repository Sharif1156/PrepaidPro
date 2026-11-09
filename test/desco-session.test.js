import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { fetchDesco, fetchDescoNotices, requestRealtimeBalance } from '../src/desco.js';
import { resetSession } from '../src/desco-session.js';

/** A tiny imitation of the new DESCO portal: XSRF cookie + header, cookie session, link, balance. */
let server;
let sessions;
let linked;
let calls;
let failNextWith401;
let realtimeRefuse;

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair[0]),
  );
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const jar = cookies(req);
      calls.push(`${req.method} ${url.pathname}`);

      if (url.pathname === '/api/auth/csrf') {
        return reply(res, 204, undefined, { 'Set-Cookie': 'XSRF-TOKEN=tok123; Path=/' });
      }
      if (url.pathname === '/api/auth/login') {
        if (req.headers['x-xsrf-token'] !== jar['XSRF-TOKEN'] || !jar['XSRF-TOKEN']) {
          return reply(res, 403, { message: 'csrf' });
        }
        const body = JSON.parse(raw || '{}');
        if (body.username !== '01700000000' || body.password !== 'secret-pass') {
          return reply(res, 401, { authenticated: false });
        }
        const id = `s${sessions.size + 1}`;
        sessions.add(id);
        return reply(res, 200, { authenticated: true, userId: 1, mustChangePassword: false }, {
          'Set-Cookie': `SESSION=${id}; Path=/; HttpOnly`,
        });
      }
      if (url.pathname === '/api/public/notices/active') {
        return reply(res, 200, [
          { id: 5, title: 'New portal', body: 'Please log in', priority: 'NORMAL', updatedAt: '2026-11-06T17:43:58Z' },
          { id: 6, title: 'Old notice', body: 'x', priority: 'NORMAL', endsAt: '2020-01-01T00:00:00Z' },
        ]);
      }
      if (url.pathname === '/api/public/notices/homepage') {
        return reply(res, 200, [{ id: 4, title: 'Monthly charges', body: 'info', priority: 'EMERGENCY', startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z' }]);
      }
      if (!sessions.has(jar.SESSION) || failNextWith401) {
        failNextWith401 = false;
        sessions.clear();
        return reply(res, 401, { message: 'login' });
      }
      if (url.pathname === '/api/accounts' && req.method === 'GET') {
        return reply(res, 200, {
          accounts: linked.map((accountNo, index) => ({ accountId: 100 + index, accountNo })),
          canAddAccount: linked.length < 2,
          linkedAccountCount: linked.length,
        });
      }
      if (url.pathname === '/api/accounts/link' && req.method === 'POST') {
        if (req.headers['x-xsrf-token'] !== jar['XSRF-TOKEN']) return reply(res, 403, {});
        const { accountNo } = JSON.parse(raw);
        if (accountNo === '99999999') return reply(res, 422, { message: 'not found' });
        linked.push(accountNo);
        return reply(res, 201, { accountId: 99 + linked.length, accountNo });
      }
      const match = url.pathname.match(/^\/api\/accounts\/(\d+)\/(.+)$/);
      if (match && match[2] === 'balance') {
        return reply(res, 200, {
          accountNo: linked[Number(match[1]) - 100],
          meterNo: '661120128359',
          balance: 5703.88,
          currentMonthConsumedTaka: 1629.81,
          readingTime: '2026-11-07 15:30:00',
          stale: false,
        });
      }
      if (match && match[2] === 'usage/monthly') {
        return reply(res, 200, { rows: [{ month: '2026-10', consumedUnit: 210.5, consumedTaka: 1800 }] });
      }
      if (match && match[2] === 'transactions') {
        return reply(res, 200, { items: [{ transactionTime: '2026-11-02 10:00:00', totalAmount: 3970, tokenNo: '1234' }] });
      }
      if (match && match[2] === 'usage/daily') {
        return reply(res, 200, { days: [{ date: '2026-11-05', consumedUnit: 8.2, consumedTaka: 70 }, { date: '2026-11-06', consumedUnit: 9, consumedTaka: 77 }] });
      }
      if (match && match[2] === 'tokens') {
        return reply(res, 200, { tokens: [{ tokenDate: '2026-11-02 10:00:00', tokenNo: '1111 2222 3333', amount: 3970, unit: 410 }, { note: 'no token number' }] });
      }
      if (match && match[2] === 'realtime-balance' && req.method === 'POST') {
        if (req.headers['x-xsrf-token'] !== jar['XSRF-TOKEN']) return reply(res, 403, {});
        if (realtimeRefuse) return reply(res, 429, { message: 'You have already requested a realtime balance for this meter today.' });
        return reply(res, 200, { status: 'SUCCESS', balance: 5480.11, receivedAt: '2026-11-07T11:20:33.000Z', remainingAttempts: 2 });
      }
      return reply(res, 404, {});
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.DESCO_BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  delete process.env.DESCO_BASE;
  delete process.env.DESCO_USERNAME;
  delete process.env.DESCO_PASSWORD;
  server.close();
});

beforeEach(() => {
  sessions = new Set();
  linked = [];
  calls = [];
  failNextWith401 = false;
  realtimeRefuse = false;
  resetSession();
  process.env.DESCO_USERNAME = '01700000000';
  process.env.ALLOW_SHARED_LOGIN = '1';
  process.env.DESCO_PASSWORD = 'secret-pass';
});

test('signs in with the XSRF token, links the meter, and reads the balance', async () => {
  const account = await fetchDesco('26027256');
  assert.equal(account.balance, 5703.88);
  assert.equal(account.meterNo, '661120128359');
  assert.equal(account.currentMonth.taka, 1800);
  assert.equal(account.monthly[0].month, '2026-10');
  assert.equal(account.recharges[0].amount, 3970);
  assert.equal(account.readingTime, '2026-11-07T15:30:00+06:00');
  assert.deepEqual(linked, ['26027256']);
});

test('reuses the session and the link on the next lookup', async () => {
  await fetchDesco('26027256');
  calls.length = 0;
  await fetchDesco('26027256');
  assert.ok(!calls.includes('POST /api/auth/login'), 'no second login');
  assert.ok(!calls.includes('POST /api/accounts/link'), 'no second link');
});

test('signs in again when the session has expired', async () => {
  await fetchDesco('26027256');
  sessions.clear();
  const again = await fetchDesco('26027256');
  assert.equal(again.balance, 5703.88);
});

test('a wrong password is reported clearly', async () => {
  process.env.DESCO_PASSWORD = 'nope';
  await assert.rejects(() => fetchDesco('26027256'), (error) => error.code === 'DESCO_LOGIN_FAILED');
});

test('an unknown meter number is "not found"', async () => {
  await assert.rejects(() => fetchDesco('99999999'), (error) => error.code === 'ACCOUNT_NOT_FOUND');
});

test('stops cleanly when the 20-meter link limit is reached', async () => {
  linked.push('11111111', '22222222');
  await assert.rejects(() => fetchDesco('26027256'), (error) => error.code === 'DESCO_LINK_LIMIT');
});

test('daily usage and tokens come through', async () => {
  const account = await fetchDesco('26027256');
  assert.deepEqual(account.daily.map((row) => row.date), ['2026-11-05', '2026-11-06']);
  assert.equal(account.daily[1].taka, 77);
  assert.equal(account.tokens.length, 1, 'rows without a token number are dropped');
  assert.equal(account.tokens[0].tokenNo, '1111 2222 3333');
  assert.equal(account.tokens[0].unit, 410);
});

test('notices: shows open ones, hides expired ones, urgent first', async () => {
  const notices = await fetchDescoNotices();
  assert.deepEqual(notices.map((item) => item.id), ['4', '5']);
  assert.equal(notices[0].priority, 'EMERGENCY');
});

test('live meter reading returns the balance, then asks to wait', async () => {
  const live = await requestRealtimeBalance('26027256');
  assert.equal(live.balance, 5480.11);
  assert.equal(live.remainingAttempts, 2);
  await assert.rejects(() => requestRealtimeBalance('26027256'), (error) => error.code === 'REALTIME_COOLDOWN');
});

test('a refusal from the portal is passed on in plain words', async () => {
  realtimeRefuse = true;
  await assert.rejects(
    () => requestRealtimeBalance('26025483'),
    (error) => error.code === 'REALTIME_REFUSED' && /already requested/.test(error.message),
  );
});
