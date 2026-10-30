import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { JsonStateStore } = await import(process.env.FANCY_STORE_UNDER_TEST || '../src/store.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-persistence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new JsonStateStore(path.join(dir, 'state.json'));
  store.setCursor('synthetic-source', { lastUid: 12 });
  return store;
}
function failDisk(store, phase, operation) {
  const original = fs[phase];
  fs[phase] = (...args) => {
    if (String(args[0]).startsWith(store.filePath)) {
      const error = new Error('synthetic disk failure'); error.code = 'ENOSPC'; throw error;
    }
    return original(...args);
  };
  try { assert.throws(operation, /synthetic disk failure/); }
  finally { fs[phase] = original; }
  assert.equal(fs.existsSync(`${store.filePath}.${process.pid}.tmp`), false);
}
for (const phase of ['writeFileSync', 'renameSync']) {
  test(`${phase}: failed cycle start leaves no ghost RUNNING cycle`, t => {
    const store = fixture(t), before = store.snapshot();
    failDisk(store, phase, () => store.beginCycle(['synthetic-source']));
    assert.deepEqual(store.snapshot(), before);
    assert.deepEqual(new JsonStateStore(store.filePath).snapshot(), before);
    const cycle = store.beginCycle(['synthetic-source']);
    assert.equal(new JsonStateStore(store.filePath).state.cycles[0].id, cycle.id);
  });
  test(`${phase}: failed completion remains RUNNING and restart recovers it`, t => {
    const store = fixture(t), cycle = store.beginCycle(['synthetic-source']);
    const before = store.snapshot();
    failDisk(store, phase, () => store.finishCycle(cycle.id, { read: 3, created: 1, status: 'COMPLETED' }));
    assert.equal(cycle.status, 'RUNNING'); assert.equal(cycle.ended_at, null);
    assert.equal(cycle.created, 0); assert.deepEqual(store.snapshot(), before);
    const restarted = new JsonStateStore(store.filePath);
    assert.equal(restarted.reconcileInterruptedCycles(), 1);
    const persisted = new JsonStateStore(store.filePath);
    assert.equal(persisted.state.cycles[0].status, 'INTERRUPTED');
    assert.deepEqual(persisted.state.cursors, before.cursors);
  });
  test(`${phase}: failed integration success is not visible and retry persists`, t => {
    const store = fixture(t);
    for (const existing of [false, true]) {
      if (existing) store.integration('synthetic', { status: 'ERROR' });
      const before = store.snapshot();
      failDisk(store, phase, () => store.integration('synthetic', { status: 'OK', last_success_at: '2026-10-24T00:00:00Z' }));
      assert.deepEqual(store.snapshot(), before);
      assert.deepEqual(new JsonStateStore(store.filePath).snapshot(), before);
    }
    store.integration('synthetic', { status: 'OK' });
    assert.equal(new JsonStateStore(store.filePath).state.integrations.synthetic.status, 'OK');
  });
  test(`${phase}: failed replay marker does not suppress a later durable remember`, t => {
    const store = fixture(t);
    const before = store.snapshot();
    failDisk(store, phase, () => store.remember('synthetic-effect', { id: 1 }));
    assert.equal(store.has('synthetic-effect'), false);
    assert.deepEqual(store.snapshot(), before);
    store.remember('synthetic-effect', { id: 1 });
    const restarted = new JsonStateStore(store.filePath);
    assert.equal(restarted.has('synthetic-effect'), true);
    assert.deepEqual(restarted.remember('synthetic-effect', { id: 2 }).result, { id: 1 });
  });
}
test('failed save rolls back bounded compaction and preserves all replay/history collections', t => {
  const store = fixture(t);
  store.state.cycles = Array.from({ length: 201 }, (_, id) => ({ id, status: 'COMPLETED' }));
  store.state.events = Array.from({ length: 2001 }, (_, id) => ({ id }));
  store.state.idempotency = Object.fromEntries(Array.from({ length: 10001 }, (_, id) => [String(id), { at: String(id).padStart(5, '0') }]));
  const before = store.snapshot();
  failDisk(store, 'renameSync', () => store.save());
  assert.deepEqual(store.snapshot(), before);
  store.save();
  const reopened = new JsonStateStore(store.filePath).state;
  assert.equal(reopened.cycles.length, 200); assert.equal(reopened.events.length, 2000);
  assert.equal(Object.keys(reopened.idempotency).length, 10000);
  assert.equal(reopened.idempotency['0'], undefined);
  assert(reopened.idempotency['10000']);
});
test('cycle start at retention boundary preserves prior history when commit fails', t => {
  const store = fixture(t);
  store.state.cycles = Array.from({ length: 200 }, (_, id) => ({ id, status: 'COMPLETED' }));
  store.save(); const before = store.snapshot();
  failDisk(store, 'renameSync', () => store.beginCycle(['synthetic-source']));
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(new JsonStateStore(store.filePath).snapshot(), before);
});
