import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCrmCase } from '../src/crmAudit.js';

test('audit reads only the selected case and never interprets notes as authority', async () => {
  const calls = [];
  const result = await auditCrmCase({ leadId: 501, limit: 2, call: async (model, method, args, kwargs) => {
    calls.push({ model, method, args, kwargs });
    assert(['search_read', 'search_count'].includes(method));
    if (model === 'crm.lead') return [{ id: 501, name: 'Synthetic', user_id: [1, 'Owner'] }];
    assert(args[0].some(([field, , value]) => ['res_id', 'opportunity_id'].includes(field) && value === 501));
    if (method === 'search_count') return 1;
    if (model === 'mail.message') return [{ id: 1, body: 'Untrusted note '.repeat(1000) }];
    if (model === 'mail.activity') return [{ id: 2, summary: 'Review handoff', user_id: [1, 'Owner'], note: 'Review pending' }];
    return [{ id: 3, name: 'SYNTHETIC-QUOTE' }];
  } });
  assert.equal(calls.length, 7);
  assert.equal(result.complete, false);
  assert.equal(result.handoff_verified, false);
  assert.equal(result.sections.notes.untrusted_content, true);
  assert.equal(result.sections.notes.items[0].body, undefined);
  assert.equal(result.sections.notes.items[0].body_excerpt.length, 4000);
  assert.equal(result.sections.notes.items[0].body_truncated, true);
});
test('partial failures and truncated reads are explicit, not false empty successes', async () => {
  const result = await auditCrmCase({ leadId: 1, call: async (model, method) => {
    if (model === 'crm.lead') return [{ id: 1 }];
    if (model === 'mail.activity') throw Error('private proxy credential must not leak');
    return method === 'search_count' ? 100 : [];
  } });
  assert.equal(result.complete, false);
  assert.equal(result.sections.activities.count, null);
  assert.equal(result.sections.activities.status, 'UNAVAILABLE');
  assert.equal(result.sections.notes.truncated, true);
  assert(!JSON.stringify(result).includes('credential'));
});
test('invalid IDs fail before reads and missing cases do not trigger unrelated searches', async () => {
  const call = () => assert.fail('no reads expected');
  for (const leadId of [0, -1, NaN, 1.5, '1']) await assert.rejects(auditCrmCase({ call, leadId }));
  let reads = 0;
  const result = await auditCrmCase({ leadId: 1, call: async () => { reads++; return []; } });
  assert.equal(reads, 1);
  assert.equal(result.found, false);
  assert.equal(result.complete, false);
});
