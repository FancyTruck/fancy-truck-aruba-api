import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStateStore } from '../src/store.js';
import { routeCommercialMessage } from '../src/commercialRouting.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fancy-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  const store = new JsonStateStore(file);
  const parsed = { from: { value: [{ address: 'cliente@example.com' }] },
    subject: 'Dettagli evento', text: 'Potete aiutarmi?', messageId: '<test@example.com>' };
  return { file, store, parsed, uid: 10, account: 'hello', findLead: async () => ({}) };
}

test('ambiguous mail persists across restart, deduplicates, and never looks up or writes CRM', async t => {
  const args = setup(t);
  args.findLead = () => { throw new Error('CRM must not be called'); };
  const first = await routeCommercialMessage(args);
  assert.equal(first.action, 'review');
  const reloaded = new JsonStateStore(args.file);
  const second = await routeCommercialMessage({ ...args, uid: 11, store: reloaded });
  assert.equal(second.review_id, first.review_id);
  assert.equal(second.duplicate, true);
  const rows = Object.values(reloaded.state.classification_reviews);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'DA_CLASSIFICARE');
  assert.equal(rows[0].reason, 'commercial_intent_not_established');
  assert.deepEqual(reloaded.state.actions, {});
  assert.deepEqual(reloaded.state.cases, {});
});

test('separate accounts and UID fallback preserve distinct messages', async t => {
  const args = setup(t);
  delete args.parsed.messageId;
  for (const patch of [{}, { account: 'pietro' }, { uid: 12 }]) {
    await routeCommercialMessage({ ...args, ...patch });
  }
  assert.equal(Object.keys(args.store.state.classification_reviews).length, 3);
});

test('old state files gain an empty review queue without losing data', t => {
  const args = setup(t);
  fs.writeFileSync(args.file, JSON.stringify({ version: 1, cursors: { hello: 123 } }));
  const store = new JsonStateStore(args.file);
  assert.deepEqual(store.state.classification_reviews, {});
  assert.equal(store.cursor('hello'), 123);
});

test('matched reply stays on its lead; unmatched reply and multiple matches are queued', async t => {
  const args = setup(t);
  args.parsed.subject = 'Re: Dettagli';
  const result = await routeCommercialMessage({ ...args, findLead: async () => ({ lead: { id: 42 } }) });
  assert.deepEqual(result, { action: 'reply', lead: { id: 42 } });
  assert.equal(Object.keys(args.store.state.classification_reviews).length, 0);
  assert.equal((await routeCommercialMessage(args)).reason, 'reply_without_matching_lead');
  args.parsed.messageId = '<second@example.com>';
  const ambiguous = await routeCommercialMessage({ ...args,
    findLead: async () => ({ ambiguous: true, candidate_ids: [42, 43] }) });
  assert.equal(ambiguous.action, 'review');
  assert.deepEqual(args.store.state.classification_reviews[ambiguous.review_id].candidate_ids, [42, 43]);
});

test('bulk mail is skipped and forwarded existing quotes require review without CRM access', async t => {
  const args = setup(t);
  args.findLead = () => { throw new Error('CRM must not be called'); };
  args.parsed.headers = new Map([['list-id', 'newsletter']]);
  assert.equal((await routeCommercialMessage(args)).action, 'skip');
  assert.equal(Object.keys(args.store.state.classification_reviews).length, 0);
  args.parsed.headers = new Map();
  args.parsed.subject = 'Fwd: Preventivo food truck';
  assert.equal((await routeCommercialMessage(args)).reason, 'forward_requires_review');
});

test('explicit new request reaches create decision without inserting a review', async t => {
  const args = setup(t);
  args.parsed.text = 'Vorrei un preventivo per noleggiare un food truck';
  assert.deepEqual(await routeCommercialMessage(args), { action: 'create', kind: 'rental' });
  assert.equal(Object.keys(args.store.state.classification_reviews).length, 0);
});

test('a commercial subject alone cannot turn an unmatched reply into a new lead', async t => {
  const args = setup(t);
  args.parsed.subject = 'Re: Preventivo food truck';
  args.parsed.text = 'Grazie, confermo';
  assert.equal((await routeCommercialMessage(args)).reason, 'reply_without_matching_lead');
});

test('failed persistence does not leave a false duplicate in memory', async t => {
  const args = setup(t);
  const save = args.store.save.bind(args.store);
  args.store.save = () => { throw new Error('disk unavailable'); };
  await assert.rejects(routeCommercialMessage(args), /disk unavailable/);
  assert.equal(Object.keys(args.store.state.classification_reviews).length, 0);
  args.store.save = save;
  assert.equal((await routeCommercialMessage(args)).duplicate, false);
  assert.equal(Object.keys(new JsonStateStore(args.file).state.classification_reviews).length, 1);
});

test('reused UID in a different mailbox generation is a distinct review', async t => {
  const args = setup(t);
  delete args.parsed.messageId;
  const first = await routeCommercialMessage({ ...args, uidValidity: '100' });
  const second = await routeCommercialMessage({ ...args, uidValidity: '200' });
  assert.notEqual(first.review_id, second.review_id);
});

test('authorized test mailbox messages cannot enter production intake',async()=>{
 const decision=await routeCommercialMessage({parsed:{subject:'Re: [FANCY-AI-COLLAUDO-20261021 / NOLEGGIO] Richiesta',text:'Noleggio Airstream',from:{value:[{address:'grafichefancytruck@gmail.com'}]}},store:{queueClassification:()=>{throw Error('Must not queue');}},findLead:()=>{throw Error('Must not read CRM');}});
 assert.equal(decision.action,'skip');assert.equal(decision.reason,'authorized_test_message');
});

for (const [subject,text,reason] of [
 ['[Verify email] Complete your Backblaze account setup','One more step—verify your email address to start storing your data.','automatic_service_notification'],
 ['Backblaze Account Login Notification','Someone just logged in to your Backblaze account.','automatic_service_notification'],
 ['Backblaze Account Login Notification','','automatic_service_notification'],
 ['💰 Brevetti, design e marchi: fino al 90% a fondo perduto','','administrative_or_marketing'],
 ['Reset your password','', 'automatic_service_notification'],
 ['Password reset requested','', 'automatic_service_notification'],
 ['Codice di verifica','123456','automatic_service_notification'],
]) test(`transactional/promotional mail without bulk headers: ${subject}`,async t=>{
 const args=setup(t);args.parsed.subject=subject;args.parsed.text=text;
 args.findLead=()=>{throw Error('Noncommercial message must not access CRM');};
 assert.deepEqual(await routeCommercialMessage(args),{action:'skip',reason});
 assert.equal(Object.keys(args.store.state.classification_reviews).length,0);
 assert.deepEqual(args.store.state.actions,{});
 assert.deepEqual(args.store.state.cases,{});
});
test('provider domain is not blacklisted for genuine catering requests',async t=>{
 const args=setup(t);args.parsed.from.value[0].address='events@backblaze.com';
 args.parsed.subject='Evento aziendale';args.parsed.text='Vorremmo un preventivo catering per 100 ospiti';
 assert.deepEqual(await routeCommercialMessage(args),{action:'create',kind:'catering'});
});
test('customer reply on a notification subject can still link to an existing order',async t=>{
 const args=setup(t);args.parsed.subject='Re: Backblaze Account Login Notification';
 args.parsed.text='Confermo Milano per il ritiro';args.parsed.inReplyTo='<existing@example.com>';
 const match={lead:{id:42},order_ids:[331]};args.findLead=async()=>match;
 assert.deepEqual(await routeCommercialMessage(args),{action:'link',match});
});
test('customer request accompanying a funding headline is not discarded',async t=>{
 const args=setup(t);args.parsed.subject='Brevetti, design e marchi: fino al 90% a fondo perduto';
 args.parsed.text='Vorrei un preventivo per noleggiare un food truck per la presentazione.';
 assert.deepEqual(await routeCommercialMessage(args),{action:'create',kind:'rental'});
});
test('a forward without a clear request remains reviewable',async t=>{
 const args=setup(t);args.parsed.subject='Fwd: Backblaze Account Login Notification';args.parsed.text='Puoi verificare?';
 assert.equal((await routeCommercialMessage(args)).action,'review');
});

test('reply headers preserve linking even without Re in a notification subject',async t=>{
 const args=setup(t);args.parsed.subject='Backblaze Account Login Notification';
 args.parsed.text='Confermo Milano per il ritiro';args.parsed.inReplyTo='<existing@example.com>';
 const match={lead:{id:42},order_ids:[331]};args.findLead=async()=>match;
 assert.deepEqual(await routeCommercialMessage(args),{action:'link',match});
});
