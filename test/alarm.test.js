import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextGapMinutes, decide } from '../public/js/lib/alarm.js';

const MIN = 60_000;

test('the gap after each reminder is 5, 10, 20 minutes and then 60 minutes forever', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(nextGapMinutes), [5, 10, 20, 60, 60, 60, 60]);
});

test('a balance above the limit does nothing, and clears an old reminder', () => {
  assert.equal(decide({ entry: null, balance: 500, threshold: 200 }).action, 'none');
  const cleared = decide({ entry: { count: 3, nextAt: 1, muted: false }, balance: 900, threshold: 200 });
  assert.equal(cleared.action, 'clear');
  assert.equal(cleared.entry, null);
});

test('the first low balance sends right away and schedules the next one in 5 minutes', () => {
  const now = 1_000_000;
  const step = decide({ entry: null, balance: 150, threshold: 200, now });
  assert.equal(step.action, 'send');
  assert.equal(step.entry.count, 1);
  assert.equal(step.entry.nextAt, now + 5 * MIN);
});

test('nothing is sent before the reminder is due', () => {
  const entry = { count: 1, nextAt: 10 * MIN, muted: false };
  assert.equal(decide({ entry, balance: 150, threshold: 200, now: 10 * MIN - 1 }).action, 'none');
});

test('the full sequence: 0, 5, 15, 35, 95, 155 minutes', () => {
  let entry = null;
  const sentAt = [];
  for (let minute = 0; minute <= 160; minute += 1) {
    const step = decide({ entry, balance: 100, threshold: 200, now: minute * MIN });
    entry = step.entry;
    if (step.action === 'send') sentAt.push(minute);
  }
  assert.deepEqual(sentAt, [0, 5, 15, 35, 95, 155]);
});

test('a muted meter stays quiet until the balance recovers, then can alert again', () => {
  const muted = { count: 2, nextAt: 0, muted: true };
  assert.equal(decide({ entry: muted, balance: 100, threshold: 200, now: 999 * MIN }).action, 'none');
  assert.equal(decide({ entry: muted, balance: 800, threshold: 200 }).action, 'clear');
  assert.equal(decide({ entry: null, balance: 100, threshold: 200 }).action, 'send');
});

test('a balance equal to the limit counts as low, an unknown balance does not', () => {
  assert.equal(decide({ entry: null, balance: 200, threshold: 200 }).action, 'send');
  assert.equal(decide({ entry: null, balance: null, threshold: 200 }).action, 'none');
});
