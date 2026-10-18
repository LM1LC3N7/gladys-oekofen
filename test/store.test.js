// -----------------------------------------------------------------------------
// What /data keeps (src/store.js), repaired and capped when read back.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMemory } from '../src/store.js';
import { HOUR, NOW } from './fixtures/oekofen.js';

const key = 'a'.repeat(32);

test('pauses are capped: 6 h for a 429, 1 h for a backoff', () => {
  const rate = normalizeMemory({ key, pause: { kind: 'rate', until: NOW + 99 * HOUR } }, NOW);
  assert.deepEqual(rate.pause, { kind: 'rate', until: NOW + 6 * HOUR, failures: 0 });
  const backoff = normalizeMemory(
    { key, pause: { kind: 'backoff', until: NOW + 99 * HOUR, failures: 99 } },
    NOW,
  );
  assert.deepEqual(backoff.pause, { kind: 'backoff', until: NOW + HOUR, failures: 10 });
  assert.equal(normalizeMemory({ key, pause: { until: 'x' } }, NOW).pause, null);
});

test('alarms: bounded, strings only, boiler ids only; nothing without a key', () => {
  const seen = Array.from({ length: 300 }, (_, i) => `k${i}`);
  const memory = normalizeMemory(
    { key, alarms: { seen: [...seen, 42, 'x'.repeat(600)], faulted: ['pe1', '__proto__', 'hk1'] } },
    NOW,
  );
  assert.equal(memory.alarms.seen.length, 200);
  assert.equal(memory.alarms.seen.at(-1), 'k299');
  assert.deepEqual(memory.alarms.faulted, ['pe1']);
  assert.equal(normalizeMemory({ alarms: { seen: ['a'] } }, NOW).alarms, null);
  assert.equal(normalizeMemory({ key, alarms: { seen: 'a' } }, NOW).alarms, null);
});
