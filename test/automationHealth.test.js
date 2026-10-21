import test from 'node:test';
import assert from 'node:assert/strict';
import { automationHealth } from '../src/automationHealth.js';

const now = Date.UTC(2026, 9, 22, 9);
const runtime = { readOnly: false, automationEnabled: true };
const cycle = patch => ({ status: 'COMPLETED', started_at: new Date(now - 60000).toISOString(),
  ended_at: new Date(now - 1000).toISOString(), failed: 0, suspended: 0, ...patch });
const health = (cycles, patch = {}) => automationHealth({ runtime, cycles, now,
  startedAt: now - 60000, operatingNow: true, ...patch });

test('a fresh failed, interrupted or suspended cycle cannot report OK', () => {
  for (const c of [cycle({ status: 'INTERRUPTED' }), cycle({ status: 'CONTROLLO NON COMPLETATO' }),
    cycle({ failed: 1 }), cycle({ suspended: 1 })]) {
    const before = JSON.stringify(c);
    assert.equal(health([c]).status, 'DEGRADED');
    assert.deepEqual(health([c]).reasons, ['LAST_CYCLE_INCOMPLETE']);
    assert.equal(JSON.stringify(c), before);
  }
});
test('stalled cycles use their original start, not the restarted process time', () => {
  const c = cycle({ status: 'RUNNING', started_at: new Date(now - 3 * 3600000).toISOString(), ended_at: null });
  assert.equal(health([c], { startedAt: now }).status, 'DEGRADED');
  assert.equal(health([c], { operatingNow: false }).stale, true);
  assert.equal(health([cycle({ status: 'RUNNING', ended_at: null })]).status, 'RUNNING');
});
test('missing evidence and invalid times never imply a verified cycle', () => {
  assert.equal(health([]).status, 'NOT_YET_VERIFIED');
  assert.equal(health([], { startedAt: now - 11 * 60000 }).status, 'DEGRADED');
  for (const c of [cycle({ ended_at: 'invalid' }), cycle({ status: 'RUNNING', started_at: 'invalid' })]) {
    assert.equal(health([c]).status, 'DEGRADED');
  }
});
test('healthy, disabled and out-of-window reports remain distinct', () => {
  assert.equal(health([cycle({})]).status, 'OK');
  assert.equal(health([cycle({ failed: 1 })], { runtime: { ...runtime, readOnly: true } }).status, 'DISABLED');
  const old = cycle({ ended_at: new Date(now - 8 * 3600000).toISOString() });
  assert.equal(health([old]).status, 'DEGRADED');
  assert.equal(health([old], { operatingNow: false }).status, 'OK');
  assert.equal(health([cycle({ failed: 1 })], { operatingNow: false }).status, 'DEGRADED');
});
