import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStateStore } from '../src/store.js';
import { runMailOperation } from '../src/mailOperations.js';
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fancy-operation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { store: new JsonStateStore(path.join(dir, 'state.json')), account: 'hello', validity: '1', uid: 1,
    parsed: { messageId: '<one@example.com>', subject: 'Richiesta' } };
}
test('completed operation replays result after restart without external writes', async t => {
  const args = setup(t); let writes = 0;
  const execute = async () => { writes++; return { lead_id: 42 }; };
  await runMailOperation({ ...args, execute });
  const result = await runMailOperation({ ...args, store: new JsonStateStore(args.store.filePath), execute });
  assert.equal(writes, 1); assert.equal(result.lead_id, 42); assert.equal(result.duplicate, true);
});
test('partial write is routed to persistent review rather than repeated', async t => {
  const args = setup(t); let writes = 0;
  const execute = async () => { writes++; throw new Error('timeout after create'); };
  await assert.rejects(runMailOperation({ ...args, execute }), /timeout/);
  const store = new JsonStateStore(args.store.filePath);
  const result = await runMailOperation({ ...args, store, execute });
  assert.equal(result.suspended, true); assert.equal(writes, 1);
  await runMailOperation({ ...args, store, execute });
  assert.equal(Object.keys(store.state.classification_reviews).length, 1);
});
test('failed initial journal prevents any external operation', async t => {
  const args = setup(t); let writes = 0;
  args.store.save = () => { throw new Error('disk full'); };
  await assert.rejects(runMailOperation({ ...args, execute: async () => { writes++; } }), /disk full/);
  assert.equal(writes, 0); assert.deepEqual(args.store.state.mail_operations, {});
});

test('same email seen in Odoo cannot repeat an uncertain IMAP operation', async t => {
  const args = setup(t); let writes = 0;
  await assert.rejects(runMailOperation({ ...args, execute: async () => {
    writes++; throw new Error('partial');
  } }), /partial/);
  const result = await runMailOperation({ ...args, account: 'odoo', mailbox: 'crm.lead', uid: 999,
    execute: async () => { writes++; return { reply: true }; } });
  assert.equal(result.suspended, true); assert.equal(writes, 1);
});
test('failed completion journal leaves uncertain operation for review', async t => {
  const args = setup(t); let writes = 0;
  const save = args.store.save.bind(args.store);
  await assert.rejects(runMailOperation({ ...args, execute: async () => {
    writes++; args.store.save = () => { throw new Error('disk full'); }; return { lead_id: 42 };
  } }), /disk full/);
  const store = new JsonStateStore(args.store.filePath);
  const result = await runMailOperation({ ...args, store, execute: async () => { writes++; } });
  assert.equal(result.suspended, true); assert.equal(writes, 1);
  args.store.save = save;
});

test('manual reconciliation survives restart and cross-channel replay without repeating writes', async t => {
  const args = setup(t); let writes = 0;
  const execute = async () => { writes++; throw new Error('uncertain'); };
  await assert.rejects(runMailOperation({ ...args, execute }));
  const pending = await runMailOperation({ ...args, execute });
  args.store.resolveClassification(pending.review_id, 'HANDLED_MANUALLY', 'Verificata e completata pratica CRM 42', 'reviewer');
  const store = new JsonStateStore(args.store.filePath);
  const replay = await runMailOperation({ ...args, store, account: 'odoo', uid: 99, execute });
  assert.equal(replay.handled_manually, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.suspended, undefined);
  assert.equal(writes, 1);
});

test('failed reconciliation save rolls back both review and journal', async t => {
  const args = setup(t);
  await assert.rejects(runMailOperation({ ...args, execute: async () => { throw new Error('uncertain'); } }));
  const pending = await runMailOperation({ ...args, execute: async () => assert.fail('must not execute') });
  const before = args.store.snapshot();
  args.store.save = () => { throw new Error('disk full'); };
  assert.throws(() => args.store.resolveClassification(pending.review_id, 'HANDLED_MANUALLY', 'Verificata e completata pratica CRM 42', 'reviewer'), /disk full/);
  assert.deepEqual(args.store.snapshot(), before);
  assert.deepEqual(new JsonStateStore(args.store.filePath).snapshot(), before);
});
