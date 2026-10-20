import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dailyCostFromMonthly,
  dailyCostFromRecharges,
  estimateDailyCost,
  forecastBalance,
  rechargePattern,
  monthToDate,
  dailySeries,
  riskLevel,
  formatDays,
  round2,
} from '../public/js/lib/forecast.js';

const monthlyFixture = [
  { month: '2026-05', taka: 3000, unit: 380 },
  { month: '2026-06', taka: 3300, unit: 415 },
  { month: '2026-07', taka: 3100, unit: 390 },
  { month: '2026-08', taka: 2900, unit: 365 },
  { month: '2026-09', taka: 2800, unit: 350 },
  { month: '2026-10', taka: 1500, unit: 180 },
];

const now = new Date('2026-10-20T10:00:00+06:00');

test('daily cost is a weighted average of monthly readings', () => {
  const result = dailyCostFromMonthly(monthlyFixture, now);
  assert.ok(result.perDay > 50 && result.perDay < 120, `unexpected ${result.perDay}`);
  assert.equal(result.samples.length, monthlyFixture.length);
  assert.equal(result.method, 'recency-weighted monthly readings');
});

test('the current partial month is scaled to elapsed days', () => {
  const result = dailyCostFromMonthly(monthlyFixture, now);
  const current = result.samples.find((sample) => sample.isCurrent);
  assert.ok(current, 'current month missing');
  // 1500 BDT over 20 elapsed days, not over 31
  assert.equal(current.perDay, 75);
});

test('monthly rows without a usable amount are ignored', () => {
  const result = dailyCostFromMonthly(
    [
      { month: '2026-08', taka: null },
      { month: '2026-09', taka: 0 },
      { month: 'not-a-month', taka: 5000 },
      { month: '2026-10', taka: 1500 },
    ],
    now,
  );
  assert.equal(result.samples.length, 1);
  assert.equal(result.perDay, 75);
});

test('empty data returns null instead of NaN', () => {
  assert.deepEqual(dailyCostFromMonthly([], now).perDay, null);
  assert.equal(dailyCostFromMonthly(null, now).method, 'none');
  assert.equal(dailyCostFromRecharges([], now).perDay, null);
});

test('recharge history is a fallback when monthly data is missing', () => {
  const recharges = [
    { date: '2026-08-01T00:00:00+06:00', amount: 3000 },
    { date: '2026-09-01T00:00:00+06:00', amount: 3000 },
    { date: '2026-10-01T00:00:00+06:00', amount: 3000 },
  ];
  const estimate = estimateDailyCost({ monthly: [], recharges }, now);
  assert.equal(estimate.source, 'recharges');
  // 9000 BDT over ~80 days
  assert.ok(estimate.perDay > 100 && estimate.perDay < 120, `unexpected ${estimate.perDay}`);
});

test('forecast divides balance by daily burn', () => {
  const account = { balance: 1500, monthly: monthlyFixture, recharges: [] };
  const forecast = forecastBalance(account, { now, threshold: 200 });
  assert.ok(forecast.perDay > 0);
  assert.equal(round2(forecast.daysLeft), round2(1500 / forecast.perDay));
  assert.ok(forecast.emptyDate instanceof Date);
  assert.ok(forecast.emptyDate > now);
  assert.equal(forecast.confidence, 'high');
});

test('a meter with more balance lasts longer', () => {
  const low = forecastBalance({ balance: 300, monthly: monthlyFixture }, { now });
  const high = forecastBalance({ balance: 3000, monthly: monthlyFixture }, { now });
  assert.ok(high.daysLeft > low.daysLeft);
});

test('forecast is empty-safe: no balance, no history, no crash', () => {
  const forecast = forecastBalance({ balance: null, monthly: [] }, { now });
  assert.equal(forecast.daysLeft, null);
  assert.equal(forecast.confidence, 'none');
  assert.equal(riskLevel(forecast), 'unknown');
});

test('risk thresholds map days-left onto four levels', () => {
  assert.equal(riskLevel({ daysLeft: 0.4 }), 'critical');
  assert.equal(riskLevel({ daysLeft: 2, balance: 500 }), 'high');
  assert.equal(riskLevel({ daysLeft: 5, balance: 500 }, 200), 'medium');
  assert.equal(riskLevel({ daysLeft: 20, balance: 900 }, 200), 'low');
  assert.equal(riskLevel({ daysLeft: 4, balance: 150 }, 200), 'high');
});

test('recharge pattern reports median gap and typical amount', () => {
  const pattern = rechargePattern([
    { date: '2026-08-01T00:00:00+06:00', amount: 500 },
    { date: '2026-08-11T00:00:00+06:00', amount: 1000 },
    { date: '2026-08-31T00:00:00+06:00', amount: 2000 },
  ]);
  assert.equal(pattern.count, 3);
  assert.equal(pattern.medianAmount, 1000);
  // gaps are 10 and 20 days -> median 15
  assert.equal(pattern.medianGapDays, 15);
  assert.equal(pattern.totalSpent, 3500);
});

test('month to date projects the full month', () => {
  const mtd = monthToDate({ monthly: monthlyFixture }, now);
  assert.equal(mtd.spent, 1500);
  assert.equal(mtd.projected, Math.round((1500 / 20) * 31));
  assert.equal(mtd.monthKey, '2026-10');
});

test('daily series only includes days that have a monthly reading', () => {
  const series = dailySeries({ monthly: monthlyFixture }, { days: 40, now });
  assert.ok(series.length > 0);
  assert.ok(series.every((point) => point.taka > 0));
  assert.ok(series.every((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date)));
});

test('formatDays is grammatical', () => {
  assert.equal(formatDays(0.2), 'under a day');
  assert.equal(formatDays(1), '1 day');
  assert.equal(formatDays(1.4), '1 day');
  assert.equal(formatDays(7), '7 days');
  assert.equal(formatDays(null), '--');
});
