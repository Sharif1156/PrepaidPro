import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descoTlsStatus, ensureChain } from '../src/tls-chain.js';

test('status starts unchecked and an unreachable host reports a failure, not a throw', async () => {
  assert.equal(descoTlsStatus(), 'unchecked');
  const result = await ensureChain('127.0.0.1', 1);
  assert.match(result, /^failed:/);
});

import { monthRangeBetween, normalizeRecharges } from '../src/desco.js';

test('last year range covers months 23..12 back', () => {
  const range = monthRangeBetween(23, 12);
  const [fy, fm] = range.monthFrom.split('-').map(Number);
  const [ty, tm] = range.monthTo.split('-').map(Number);
  assert.equal((ty * 12 + tm) - (fy * 12 + fm), 11);
});

test('recharge rows keep every simple field for the detail view', () => {
  const [row] = normalizeRecharges([{ rechargeDate: '2026-11-02 21:59:00', totalAmount: 3970, vat: 100, meterRent: 42, nested: { a: 1 }, note: '' }]);
  const keys = row.details.map(([key]) => key);
  assert.ok(keys.includes('meterRent') && keys.includes('vat'));
  assert.ok(!keys.includes('nested') && !keys.includes('note'));
});
