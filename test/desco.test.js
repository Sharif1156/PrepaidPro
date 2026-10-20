import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeAccountNo,
  toObject,
  parseMonth,
  parseBdDate,
  fetchDesco,
} from '../src/desco.js';

test('account numbers are reduced to digits', () => {
  assert.equal(normalizeAccountNo(' 104 237-569 '), '104237569');
  assert.equal(normalizeAccountNo('Account: 99887766'), '99887766');
  assert.equal(normalizeAccountNo(null), '');
});

test('toObject handles both DESCO payload shapes', () => {
  assert.deepEqual(toObject({ balance: 10 }), { balance: 10 });
  assert.deepEqual(
    toObject([
      ['accountNo', '123'],
      ['balance', '456.78'],
    ]),
    { accountNo: '123', balance: '456.78' },
  );
  assert.deepEqual(toObject([{ balance: 1 }]), { balance: 1 });
  assert.deepEqual(toObject(null), {});
});

test('month keys are normalised from several formats', () => {
  assert.equal(parseMonth('2026-03'), '2026-03');
  assert.equal(parseMonth('2026-03-01'), '2026-03');
  assert.equal(parseMonth('March 2026'), '2026-03');
  assert.equal(parseMonth('Mar-2026'), '2026-03');
  assert.equal(parseMonth('03/2026'), '2026-03');
  assert.equal(parseMonth('2026 March'), '2026-03');
  assert.equal(parseMonth('মার্চ ২০২৬'), null, 'Bengali digits are out of scope');
  assert.equal(parseMonth('মার্চ 2026'), '2026-03');
});

test('dates are converted to Bangladesh time', () => {
  assert.equal(parseBdDate('2026-10-20 14:05:00'), '2026-10-20T14:05:00+06:00');
  assert.equal(parseBdDate('2026-10-20'), '2026-10-20T00:00:00+06:00');
  assert.equal(parseBdDate('20-10-2026'), '2026-10-20T00:00:00+06:00');
  assert.equal(parseBdDate('20 Oct 2026'), '2026-10-20T00:00:00+06:00');
  assert.equal(parseBdDate(null), null);
});

test('DESCO lookups reject short account numbers before hitting the network', async () => {
  await assert.rejects(() => fetchDesco('1234'), (error) => error.code === 'BAD_REQUEST');
});

test('a fake DESCO response is normalised end to end', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/getBalance')) {
      return json({
        data: {
          accountNo: '104237569',
          meterNo: 'MH6458893065',
          balance: '1234.56',
          currentMonthConsumption: '900.10',
          readingTime: '2026-10-20 00:00:00',
        },
      });
    }
    if (target.includes('/getCustomerInfo')) {
      return json({
        data: { customerName: 'Rahim Uddin', tariff: 'LT-A', sndivision: 'Mirpur S&D' },
      });
    }
    if (target.includes('/getCustomerMonthlyConsumption')) {
      return json({
        data: [
          { month: '2026-09', consumedTaka: '2100', consumedUnit: '280', maximumDemand: '2.4' },
          { month: '2026-10', consumedTaka: '900.10', consumedUnit: '120', maximumDemand: '2.1' },
        ],
      });
    }
    if (target.includes('/getRechargeHistory')) {
      return json({
        data: [
          { rechargeDate: '2026-10-01 10:00:00', totalAmount: '2000', energyAmount: '1800', VAT: '100', saleName: 'bKash' },
        ],
      });
    }
    throw new Error(`Unexpected URL ${target}`);
  };

  const account = await fetchDesco('104 237 569');
  assert.equal(account.provider, 'desco');
  assert.equal(account.accountNo, '104237569');
  assert.equal(account.balance, 1234.56);
  assert.equal(account.meterNo, 'MH6458893065');
  assert.equal(account.customer.name, 'Rahim Uddin');
  assert.equal(account.customer.division, 'Mirpur S&D');
  assert.equal(account.monthly.length, 2);
  assert.equal(account.currentMonth.taka, 900.1);
  assert.equal(account.recharges[0].amount, 2000);
  assert.equal(account.recharges[0].method, 'bKash');
  assert.match(account.readingTime, /^2026-10-20T00:00:00\+06:00$/);
});

test('an unknown account surfaces ACCOUNT_NOT_FOUND', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    json({ data: null, status: 404, message: 'No Data Found' }, 200);

  await assert.rejects(
    () => fetchDesco('999999999'),
    (error) => error.code === 'ACCOUNT_NOT_FOUND',
  );
});

test('portal downtime becomes a retryable upstream error', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  };

  await assert.rejects(
    () => fetchDesco('104237569'),
    (error) => error.code === 'UPSTREAM_UNREACHABLE' && error.retryable === true,
  );
});

test('a non-JSON portal response is reported clearly', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response('<html>maintenance</html>', { status: 200 });

  await assert.rejects(
    () => fetchDesco('104237569'),
    (error) => error.code === 'INVALID_UPSTREAM_RESPONSE',
  );
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
