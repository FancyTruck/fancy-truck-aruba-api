import test from 'node:test';
import assert from 'node:assert/strict';
import { quotationDisposition } from '../src/quotationIdentity.js';
const context = { leadId: 10, partnerId: 20, key: 'source-1' };
const quote = patch => ({ id: 1, opportunity_id: [10, 'Case'], partner_id: [20, 'Customer'],
  client_order_ref: 'AUTO:source-1', state: 'draft', ...patch });

test('several legitimate quotes in an opportunity are not classified as duplicates', () => {
  const orders = [quote({ client_order_ref: 'AUTO:other-period' }), quote({ id: 2, client_order_ref: 'AUTO:other-vehicle' })];
  const result = quotationDisposition(orders, context);
  assert.equal(result.kind, 'review');
  assert.deepEqual(result.order_ids, [1, 2]);
});
test('an exact source replay resolves its quote even when it is not first', () => {
  const exact = quote({ id: 2 });
  assert.deepEqual(quotationDisposition([quote({ client_order_ref: 'AUTO:other' }), exact], context), { kind: 'replay', order: exact });
});
test('wrong customer, cancelled quote, duplicated markers and incomplete reads require review', () => {
  for (const orders of [[quote({ partner_id: 99 })], [quote({ opportunity_id: 99 })],
    [quote({ state: 'cancel' })], [quote({}), quote({ id: 2 })]]) {
    assert.equal(quotationDisposition(orders, context).kind, 'review');
  }
  assert.equal(quotationDisposition([quote({})], { ...context, complete: false }).kind, 'review');
});
test('creation is allowed only when the complete opportunity read is empty', () => {
  assert.equal(quotationDisposition([], context).kind, 'new');
  assert.equal(quotationDisposition([], { ...context, complete: false }).kind, 'review');
});
