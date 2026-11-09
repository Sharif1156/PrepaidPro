import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descoTlsStatus, ensureChain } from '../src/tls-chain.js';

test('status starts unchecked and an unreachable host reports a failure, not a throw', async () => {
  assert.equal(descoTlsStatus(), 'unchecked');
  const result = await ensureChain('127.0.0.1', 1);
  assert.match(result, /^failed:/);
});
