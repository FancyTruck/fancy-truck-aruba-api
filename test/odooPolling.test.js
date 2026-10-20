import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStateStore } from '../src/store.js';
import { pollOdooMessages } from '../src/odooPolling.js';
import { runMailOperation } from '../src/mailOperations.js';
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fancy-odoo-poll-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const domains = [], processed = [];
  return { store: new JsonStateStore(path.join(dir, 'state.json')), domains, processed,
    now: Date.UTC(2026, 9, 20), search: async domain => { domains.push(domain); return [{ id: 2 }, { id: 1 }, { id: 3 }]; },
    processMessage: async message => { processed.push(message.id); return { reply: true }; } };
}
test('Odoo processing stops on failure and resumes after restart without a moving time window', async t => {
  const args = setup(t); const process = args.processMessage;
  const rows = await pollOdooMessages({ ...args, processMessage: async message => {
    if (message.id === 2) throw new Error('unavailable'); return process(message);
  } });
  assert.equal(rows.at(-1).retry_pending, true); assert.deepEqual(args.processed, [1]);
  await pollOdooMessages({ ...args, store: new JsonStateStore(args.store.filePath), now: args.now + 86400000 });
  assert.deepEqual(args.processed, [1, 2, 3]);
  assert.ok(args.domains[1].some(term => term[0] === 'id' && term[2] === 1));
  assert.ok(!args.domains[1].some(term => term[0] === 'date'));
});
test('initial search boundary survives empty results and restart', async t => {
  const args = setup(t); args.search = async domain => { args.domains.push(domain); return []; };
  await pollOdooMessages(args);
  await pollOdooMessages({ ...args, now: args.now + 86400000 });
  assert.deepEqual(args.domains[0], args.domains[1]);
});
test('partial Odoo operation is reviewed and later messages can continue', async t => {
  const args = setup(t); let writes = 0;
  args.search = async () => [{ id: 1 }, { id: 2 }];
  args.processMessage = message => runMailOperation({ store: args.store, account: 'odoo', mailbox: 'crm.lead',
    validity: 'mail.message', uid: message.id, parsed: { messageId: `<${message.id}>` },
    execute: async () => { writes++; if (message.id === 1) throw new Error('partial write'); return { reply: true }; },
  });
  await pollOdooMessages(args);
  const rows = await pollOdooMessages(args);
  assert.equal(rows[0].suspended, true); assert.equal(rows[1].reply, true);
  assert.equal(writes, 2);
  assert.equal(Object.keys(args.store.state.classification_reviews).length, 1);
  assert.equal(args.store.cursor('odoo:crm:messages:checkpoint').lastId, 2);
});
