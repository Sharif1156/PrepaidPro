import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../src/cache.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('cache returns the same value inside the TTL and calls the producer once', async () => {
  const cache = createCache({ ttlMs: 1000 });
  let calls = 0;
  const produce = async () => ++calls;
  const first = await cache.wrap('k', produce);
  const second = await cache.wrap('k', produce);
  assert.equal(first.value, 1);
  assert.equal(first.cached, false);
  assert.equal(second.value, 1);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test('without a stale window an expired value is fetched again', async () => {
  const cache = createCache({ ttlMs: 10 });
  let calls = 0;
  const produce = async () => ++calls;
  await cache.wrap('k', produce);
  await sleep(25);
  const again = await cache.wrap('k', produce);
  assert.equal(again.value, 2);
  assert.equal(again.stale, undefined);
});

test('stale-while-revalidate serves the old value instantly and refreshes behind it', async () => {
  const cache = createCache({ ttlMs: 10 });
  let calls = 0;
  const produce = async () => {
    calls += 1;
    await sleep(30);
    return `v${calls}`;
  };
  const opts = { staleMs: 1000 };
  const first = await cache.wrap('k', produce, 10, opts);
  assert.equal(first.value, 'v1');
  await sleep(25); // now expired but inside the stale window

  const started = Date.now();
  const second = await cache.wrap('k', produce, 10, opts);
  assert.equal(second.value, 'v1', 'old value comes back immediately');
  assert.equal(second.stale, true);
  assert.ok(Date.now() - started < 20, 'did not wait for the refresh');

  await sleep(60); // background refresh finished
  const third = await cache.wrap('k', produce, 10, opts);
  assert.equal(third.value, 'v2');
});

test('stale-while-revalidate does not start a second refresh while one is running', async () => {
  const cache = createCache({ ttlMs: 10 });
  let calls = 0;
  const produce = async () => {
    calls += 1;
    await sleep(40);
    return calls;
  };
  const opts = { staleMs: 1000 };
  await cache.wrap('k', produce, 10, opts);
  await sleep(25);
  await Promise.all([cache.wrap('k', produce, 10, opts), cache.wrap('k', produce, 10, opts)]);
  await sleep(60);
  assert.equal(calls, 2);
});

test('a failed background refresh keeps serving the stale value and never throws', async () => {
  const cache = createCache({ ttlMs: 10 });
  let fail = false;
  const produce = async () => {
    if (fail) throw new Error('portal down');
    return 'good';
  };
  const opts = { staleMs: 1000 };
  await cache.wrap('k', produce, 10, opts);
  await sleep(25);
  fail = true;
  const result = await cache.wrap('k', produce, 10, opts);
  assert.equal(result.value, 'good');
  assert.equal(result.stale, true);
  await sleep(20);
});

test('values past the stale window are dropped', async () => {
  const cache = createCache({ ttlMs: 10 });
  let calls = 0;
  const produce = async () => ++calls;
  const opts = { staleMs: 20 };
  await cache.wrap('k', produce, 10, opts);
  await sleep(60);
  const next = await cache.wrap('k', produce, 10, opts);
  assert.equal(next.value, 2);
  assert.equal(next.stale, undefined);
});
