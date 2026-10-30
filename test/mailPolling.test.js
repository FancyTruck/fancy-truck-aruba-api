import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStateStore } from '../src/store.js';
import { pollMailbox, MAX_POLL_SOURCE_BYTES } from '../src/mailPolling.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fancy-poll-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new JsonStateStore(path.join(dir, 'state.json'));
  const queries = [], processed = [];
  return { store, queries, processed, account: 'hello', now: Date.UTC(2026, 9, 20),
    client: { mailbox: { uidValidity: 123n },
      search: async query => { queries.push(query); return [3, 1, 2]; },
      fetchOne: async (uid, query) => query.size ? { size: String(uid).length } : { source: String(uid) } },
    parse: async source => ({ text: source }),
    processMessage: async (_parsed, uid) => { processed.push(uid); return { uid }; },
  };
}
const key = 'imap:hello:checkpoint';

test('oversized business mail is not downloaded, parsed, or checkpointed', async t => {
  const args = setup(t);
  const reads = [];
  args.client.fetchOne = async (uid, query) => {
    reads.push({ uid, query });
    assert.equal(query.size, true);
    return { size: MAX_POLL_SOURCE_BYTES + 1 };
  };
  args.parse = () => assert.fail('oversized MIME must not be parsed');
  const [row] = await pollMailbox(args);
  assert.equal(row.code, 'MAIL_SOURCE_LIMIT');
  assert.equal(row.retry_pending, true);
  assert.equal(args.store.cursor(key).lastUid, 0);
  assert.deepEqual(args.processed, []);
  assert.equal(reads.length, 1);
  assert.equal(new JsonStateStore(args.store.filePath).cursor(key).lastUid, 0);
});

test('size must be verified and download remains bounded if metadata understates it', async t => {
  for (const size of [undefined, -1, NaN, '100', 1.5]) {
    const args = setup(t);
    args.client.fetchOne = async (_uid, query) => {
      assert.equal(query.size, true);
      return { size };
    };
    const [row] = await pollMailbox(args);
    assert.equal(row.code, 'MESSAGE_SIZE_UNAVAILABLE');
    assert.equal(args.store.cursor(key).lastUid, 0);
  }
  const args = setup(t);
  args.client.fetchOne = async (_uid, query, options) => {
    assert.equal(options.uid, true);
    if (query.size) return { size: 10 };
    assert.deepEqual(query.source, { start: 0, maxLength: MAX_POLL_SOURCE_BYTES + 1 });
    return { source: Buffer.alloc(MAX_POLL_SOURCE_BYTES + 1) };
  };
  const [row] = await pollMailbox(args);
  assert.equal(row.code, 'MAIL_SOURCE_LIMIT');
  assert.equal(args.store.cursor(key).lastUid, 0);
  assert.deepEqual(args.processed, []);
});

test('a bounded failure preserves the previous completed UID for retry after restart', async t => {
  const args = setup(t);
  const fetch = args.client.fetchOne;
  args.client.fetchOne = async (uid, query, options) =>
    uid === 2 && query.size ? { size: MAX_POLL_SOURCE_BYTES + 1 } : fetch(uid, query, options);
  await pollMailbox(args);
  assert.deepEqual(args.processed, [1]);
  const reloaded = new JsonStateStore(args.store.filePath);
  assert.equal(reloaded.cursor(key).lastUid, 1);
  await pollMailbox({ ...args, store: reloaded, client: { ...args.client, fetchOne: fetch } });
  assert.deepEqual(args.processed, [1, 2, 3]);
  assert.equal(reloaded.cursor(key).lastUid, 3);
});

test('failure stops at incomplete message; restart after days resumes in order', async t => {
  const args = setup(t);
  const process = args.processMessage;
  args.processMessage = async (parsed, uid) => {
    if (uid === 2) throw new Error('Odoo unavailable');
    return process(parsed, uid);
  };
  const rows = await pollMailbox(args);
  assert.deepEqual(args.processed, [1]);
  assert.equal(rows.at(-1).retry_pending, true);
  assert.equal(args.store.cursor(key).lastUid, 1);
  const reloaded = new JsonStateStore(args.store.filePath);
  await pollMailbox({ ...args, store: reloaded, processMessage: process, now: args.now + 4 * 86400000 });
  assert.deepEqual(args.queries[1], { uid: '2:*' });
  assert.deepEqual(args.processed, [1, 2, 3]);
  assert.equal(reloaded.cursor(key).lastUid, 3);
});

for (const failure of ['fetch', 'parse', 'missing']) {
  test(`${failure} failure does not advance checkpoint or process later mail`, async t => {
    const args = setup(t);
    if (failure === 'fetch') args.client.fetchOne = async () => { throw new Error('IMAP down'); };
    if (failure === 'parse') args.parse = async () => { throw new Error('invalid email'); };
    if (failure === 'missing') args.client.fetchOne = async () => false;
    assert.equal((await pollMailbox(args))[0].retry_pending, true);
    assert.equal(args.store.cursor(key).lastUid, 0);
    assert.deepEqual(args.processed, []);
  });
}

test('initial date remains fixed across retries and batch starts with oldest 100', async t => {
  const args = setup(t);
  args.client.search = async query => { args.queries.push(query); return []; };
  await pollMailbox(args);
  await pollMailbox({ ...args, now: args.now + 4 * 86400000 });
  assert.equal(+args.queries[0].since, +args.queries[1].since);
  args.client.search = async () => Array.from({ length: 130 }, (_, i) => 130 - i);
  await pollMailbox(args);
  assert.deepEqual(args.processed, Array.from({ length: 100 }, (_, i) => i + 1));
});

test('mailbox reset suspends processing instead of trusting reused UIDs', async t => {
  const args = setup(t);
  await pollMailbox(args);
  args.client.mailbox.uidValidity = 456n;
  await assert.rejects(pollMailbox(args), /UIDVALIDITY cambiato/);
  assert.equal(args.store.cursor(key).uidValidity, '123');
  assert.equal(args.processed.length, 3);
});

test('legacy cursor is adopted; sequence range never reprocesses lower UIDs', async t => {
  const args = setup(t);
  args.store.setCursor('imap:hello:last_uid', 2);
  await pollMailbox(args);
  assert.deepEqual(args.queries[0], { uid: '3:*' });
  assert.deepEqual(args.processed, [3]);
});

test('checkpoint write failure rolls back memory and disk and stops the batch', async t => {
  const args = setup(t);
  args.store.setCursor(key, { lastUid: 0, uidValidity: '123', initialSince: new Date(args.now).toISOString() });
  const save = args.store.save.bind(args.store);
  args.store.save = () => { throw new Error('disk full'); };
  const rows = await pollMailbox(args);
  assert.equal(rows[0].retry_pending, true);
  assert.equal(args.store.cursor(key).lastUid, 0);
  assert.equal(new JsonStateStore(args.store.filePath).cursor(key).lastUid, 0);
  assert.deepEqual(args.processed, [1]);
  args.store.save = save;
});

