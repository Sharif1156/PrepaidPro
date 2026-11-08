import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { checkPortal, formatReport, shapeOf } from '../src/portal-check.js';
import { resetSession } from '../src/desco-session.js';

let server;
let mode;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const cookie = String(req.headers.cookie || '');
      if (url.pathname === '/api/auth/csrf') return send(res, 204, undefined, { 'Set-Cookie': 'XSRF-TOKEN=t; Path=/' });
      if (url.pathname === '/api/auth/login') {
        return send(res, 200, { authenticated: true }, { 'Set-Cookie': 'SESSION=s; Path=/; HttpOnly' });
      }
      if (url.pathname.startsWith('/api/public/')) return send(res, 200, []);
      if (!cookie.includes('SESSION=s')) return send(res, 401, {});
      if (url.pathname === '/api/accounts') {
        return send(res, 200, mode === 'nolinks' ? { accounts: [] } : { accounts: [{ accountId: 7, accountNo: '26027256' }], canAddAccount: true });
      }
      const match = url.pathname.match(/^\/api\/accounts\/7\/(.+)$/);
      if (!match) return send(res, 404, {});
      switch (match[1]) {
        case 'balance':
          return send(res, 200, { accountNo: '26027256', meterNo: '661120128359', balance: 5703.88, readingTime: '2026-11-07 15:30:00' });
        case 'usage/monthly':
          return send(res, 200, {
            rows: mode === 'renamed'
              ? [{ periodX: '2026-10', kwhUsed: 210, spent: 1800 }]
              : [{ month: '2026-10', consumedUnit: 210, consumedTaka: 1800 }],
          });
        case 'usage/daily':
          return send(res, 200, { days: [{ date: '2026-11-06', consumedUnit: 9, consumedTaka: 77 }] });
        case 'transactions':
          return send(res, 200, { items: [{ transactionTime: '2026-11-02 10:00:00', totalAmount: 3970 }] });
        case 'tokens':
          return send(res, mode === 'tokens-down' ? 500 : 200, { tokens: [{ tokenDate: '2026-11-02 10:00:00', tokenNo: '1111 2222 3333', amount: 3970 }] });
        default:
          return send(res, 404, {});
      }
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
  mode = 'normal';
  resetSession();
  process.env.DESCO_USERNAME = '01700000000';
  process.env.DESCO_PASSWORD = 'secret-pass';
});

test('a healthy portal passes every check', async () => {
  const result = await checkPortal();
  assert.equal(result.ok, true, formatReport(result));
  assert.ok(result.checks.every((check) => check.status === 'ok'), JSON.stringify(result.checks));
});

test('renamed fields are caught: rows arrive but cannot be read', async () => {
  mode = 'renamed';
  const result = await checkPortal();
  assert.equal(result.ok, false);
  const monthly = result.checks.find((check) => check.name === 'usage/monthly');
  assert.equal(monthly.status, 'fail');
  assert.match(monthly.note, /renamed/);
});

test('a failing endpoint is reported by name', async () => {
  mode = 'tokens-down';
  const result = await checkPortal();
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.name === 'tokens').status, 'fail');
});

test('no linked meter and no login are reported, not thrown', async () => {
  mode = 'nolinks';
  assert.equal((await checkPortal()).ok, false);
  delete process.env.DESCO_PASSWORD;
  const result = await checkPortal();
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].name, 'credentials');
});

test('the report holds field names only, never values', async () => {
  mode = 'renamed';
  const report = formatReport(await checkPortal());
  for (const secret of ['661120128359', '5703.88', '26027256', '1111 2222 3333', 'secret-pass', '01700000000']) {
    assert.ok(!report.includes(secret), `report leaked ${secret}`);
  }
  assert.match(report, /"balance": "number"/);
});

test('shapeOf describes structure only', () => {
  assert.deepEqual(shapeOf({ a: 1, b: 'x', c: [{ d: true }, { d: false }], e: null }), {
    a: 'number',
    b: 'string',
    c: [{ d: 'boolean' }, '(2 items)'],
    e: 'null',
  });
});
