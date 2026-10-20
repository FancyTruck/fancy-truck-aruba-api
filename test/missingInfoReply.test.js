import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMissingInfoReply } from '../src/missingInfoReply.js';

function fixture() {
  const saved = new Map();
  const events = [];
  const sent = [];
  return {
    store: { has: k => saved.has(k), remember: (k, v) => saved.set(k, v), audit: (...a) => events.push(a) },
    runtime: { readOnly: false }, enabled: true, leadId: 10,
    parsed: { subject: 'Richiesta preventivo truck', text: 'Vorrei noleggiare un bar truck',
      from: { value: [{ address: 'client@example.com' }] }, messageId: '<request@example.com>' },
    html: '<p>Quali sono le date?</p>',
    send: async message => { sent.push(message); return { accepted: ['client@example.com'], rejected: [], messageId: 'test' }; },
    sent, events,
  };
}
test('one automatic request per new lead, addressed to actual sender and threaded', async () => {
  const f = fixture();
  assert.equal((await sendMissingInfoReply(f)).sent, true);
  assert.equal((await sendMissingInfoReply(f)).reason, 'already_attempted');
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'client@example.com');
  assert.equal(f.sent[0].inReplyTo, '<request@example.com>');
  assert.equal(f.sent[0].headers['Auto-Submitted'], 'auto-replied');
});
test('disabled and read-only cannot send', async () => {
  const f = fixture();
  assert.equal((await sendMissingInfoReply({ ...f, enabled: false })).sent, false);
  await assert.rejects(sendMissingInfoReply({ ...f, runtime: { readOnly: true } }));
  assert.equal(f.sent.length, 0);
});
test('notifications and automatic messages cannot send', async () => {
  for (const parsed of [
    { subject: 'Nuovo documento disponibile', text: 'Fancy Truck' },
    { headers: new Map([['auto-submitted', 'auto-replied']]) },
    { from: { value: [{ address: 'noreply@example.com' }] } },
  ]) {
    const f = fixture();
    assert.equal((await sendMissingInfoReply({ ...f, parsed: { ...f.parsed, ...parsed } })).sent, false);
    assert.equal(f.sent.length, 0);
  }
});
test('uncertain SMTP delivery never automatically retries', async () => {
  const f = fixture();
  const result = await sendMissingInfoReply({ ...f, send: async () => { throw new Error('timeout'); } });
  assert.equal(result.reason, 'delivery_uncertain');
  assert.equal((await sendMissingInfoReply(f)).reason, 'already_attempted');
  assert.equal(f.sent.length, 0);
});
