import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { MAX_POLL_SOURCE_BYTES as limit } from '../src/mailPolling.js';

test('actual message HTTP route bounds MIME, releases readonly lock and logs out', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'message-bound-http-'));
  Object.assign(process.env, { APP_ENV: 'test', PORT: '0', STATE_FILE: path.join(dir, 'state.json'),
    API_TOKEN: 'synthetic-message-token', READ_ONLY: 'true', AUTOMATION_ENABLED: 'false',
    STARTUP_CHECKS: 'false', EXTERNAL_BACKUP_ENABLED: 'false',
    HELLO_EMAIL: 'synthetic@example.invalid', HELLO_PASSWORD: 'synthetic-only' });
  const names = ['connect', 'logout', 'getMailboxLock', 'fetchOne', 'download'];
  const original = Object.fromEntries(names.map(name => [name, ImapFlow.prototype[name]]));
  let mode = 'oversized', locks = 0, releases = 0, logouts = 0, sourceReads = 0, downloads = 0;
  ImapFlow.prototype.connect = async function() {};
  ImapFlow.prototype.logout = async function() { logouts++; };
  ImapFlow.prototype.getMailboxLock = async function(mailbox, options) {
    assert.equal(mailbox, 'INBOX'); assert.equal(options.readOnly, true); locks++;
    return { release() { releases++; } };
  };
  ImapFlow.prototype.download = async function() { downloads++; throw Error('Unbounded download forbidden'); };
  const mime = Buffer.from('From: synthetic@example.invalid\r\nTo: reader@example.invalid\r\nSubject: Synthetic\r\n\r\nSynthetic body');
  ImapFlow.prototype.fetchOne = async function(uid, query, options) {
    assert.equal(uid, 1); assert.equal(options.uid, true);
    if (query.size) return mode === 'unknown' ? false : { size: mode === 'oversized' ? limit + 1 : mime.length };
    sourceReads++; assert.deepEqual(query.source, { start: 0, maxLength: limit + 1 });
    return { source: mode === 'lying' ? Buffer.alloc(limit + 1) : mime };
  };
  const app = await import('../src/server.js');
  if (!app.server.listening) await once(app.server, 'listening');
  t.after(async () => {
    for (const name of names) ImapFlow.prototype[name] = original[name];
    await new Promise(resolve => app.server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  });
  const before = app.store.snapshot(), base = 'http://127.0.0.1:' + app.server.address().port;
  const get = () => fetch(base + '/v1/hello/messages/1', { headers: { authorization: 'Bearer synthetic-message-token' } });
  let r = await get(); assert.equal(r.status, 413); assert.equal((await r.json()).code, 'MAIL_SOURCE_LIMIT'); assert.equal(sourceReads, 0);
  mode = 'unknown'; r = await get(); assert.equal(r.status, 502); assert.equal((await r.json()).code, 'MESSAGE_SIZE_UNAVAILABLE'); assert.equal(sourceReads, 0);
  mode = 'lying'; r = await get(); assert.equal(r.status, 413);
  mode = 'valid'; r = await get(); assert.equal(r.status, 200); assert.equal((await r.json()).message.subject, 'Synthetic');
  assert.equal(downloads, 0); assert.equal(locks, 4); assert.equal(releases, 4); assert.equal(logouts, 4);
  assert.deepEqual(app.store.snapshot(), before);
});
