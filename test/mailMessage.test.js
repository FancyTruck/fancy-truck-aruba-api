import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedMessage } from '../src/mailMessage.js';
import { MAX_POLL_SOURCE_BYTES as limit } from '../src/mailPolling.js';

function fixture(size, source) {
  const calls = []; let parses = 0;
  const client = { async fetchOne(uid, query, options) {
    calls.push({ uid, query, options });
    return query.size ? { size } : source === null ? false : { source };
  }, async download() { throw Error('Unbounded download forbidden'); } };
  const read = (uid = 1) => readBoundedMessage({ client, uid, parse: async bytes => {
    parses++; return { bytes: Buffer.byteLength(bytes) };
  } });
  return { read, calls, get parses() { return parses; } };
}
test('oversized metadata prevents MIME fetch and parser use', async () => {
  const f = fixture(limit + 1, Buffer.from('synthetic'));
  await assert.rejects(f.read(), { code: 'MAIL_SOURCE_LIMIT' });
  assert.equal(f.calls.length, 1); assert.equal(f.parses, 0);
});
test('unknown or invalid size fails closed before source fetch', async () => {
  for (const size of [undefined, NaN, -1, 0.5]) {
    const f = fixture(size, Buffer.from('synthetic'));
    await assert.rejects(f.read(), { code: 'MESSAGE_SIZE_UNAVAILABLE' });
    assert.equal(f.calls.length, 1); assert.equal(f.parses, 0);
  }
});
test('lying size cannot pass an oversized returned source to parser', async () => {
  const f = fixture(1, Buffer.alloc(limit + 1));
  await assert.rejects(f.read(), { code: 'MAIL_SOURCE_LIMIT' });
  assert.equal(f.parses, 0);
  assert.deepEqual(f.calls[1], { uid: 1, query: { source: { start: 0, maxLength: limit + 1 } }, options: { uid: true } });
});
test('exact boundary is accepted with UID semantics and parsed once', async () => {
  const f = fixture(limit, Buffer.alloc(limit));
  assert.deepEqual(await f.read(42), { bytes: limit }); assert.equal(f.parses, 1);
  assert.equal(f.calls[0].uid, 42); assert.deepEqual(f.calls[0].options, { uid: true });
});
test('missing source and unsafe UID never reach parser', async () => {
  const missing = fixture(20, null);
  await assert.rejects(missing.read(), { code: 'MESSAGE_UNAVAILABLE' });
  for (const uid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture(20, Buffer.from('synthetic'));
    await assert.rejects(f.read(uid), { code: 'INVALID_UID' }); assert.equal(f.calls.length, 0);
  }
});
test('parser errors propagate without checkpoint operations', async () => {
  const failure = Error('synthetic parser failure');
  await assert.rejects(readBoundedMessage({ client: { async fetchOne(_, query) {
    return query.size ? { size: 1 } : { source: Buffer.from('x') };
  } }, uid: 1, parse: async () => { throw failure; } }), error => error === failure);
});
