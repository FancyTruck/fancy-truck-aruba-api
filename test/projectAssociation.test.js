import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectAssociation } from '../src/projectAssociation.js';

const schema = [
  { name: 'partner_id', ttype: 'many2one', relation: 'res.partner' },
  { name: 'sale_order_id', ttype: 'many2one', relation: 'sale.order' },
  { name: 'reinvoiced_sale_order_id', ttype: 'many2one', relation: 'sale.order' },
  { name: 'sale_line_id', ttype: 'many2one', relation: 'sale.order.line' },
];
const order = { id: 30, name: 'SYNTHETIC-30', state: 'draft', partner_id: [7, 'Customer'], opportunity_id: [20, 'Case'] };
const project = { id: 40, name: 'Existing synthetic project', active: true, partner_id: [7, 'Customer'],
  sale_order_id: false, reinvoiced_sale_order_id: [30, 'Order'], sale_line_id: false };
function fixture(options = {}) {
  const calls = [];
  const call = async (model, method, args, kwargs) => {
    calls.push({ model, method, args, kwargs });
    assert.equal(method, 'search_read', 'association must never create, confirm, post or write');
    if (options.fail === model) throw Error('private provider error');
    if (model === 'sale.order') return options.orders ?? [order];
    if (model === 'ir.model.fields') return options.schema ?? schema;
    if (model === 'project.project') {
      assert.equal(kwargs.limit, 2);
      assert.equal(kwargs.context.active_test, false);
      assert.deepEqual(args[0], ['|', '|', '|', ['sale_order_id', '=', 30],
        ['reinvoiced_sale_order_id', '=', 30], ['sale_line_id.order_id', '=', 30], ['name', '=', 'Synthetic target']]);
      return options.projects ?? [project];
    }
    if (model === 'sale.order.line') return options.lines ?? [{ id: 50, order_id: [30, 'Order'] }];
    assert.fail(`Unexpected model ${model}`);
  };
  return { calls, run: patch => resolveProjectAssociation({ call, leadId: 20, orderId: 30,
    partnerId: 7, projectName: 'Synthetic target', ...patch }) };
}
test('reuses billing relation on a draft with no confirmation or task creation', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, 'REUSED');
  assert.equal(result.id, 40);
  assert.deepEqual(result.relations, ['reinvoiced_sale_order_id']);
  assert.equal(result.tasks_verified, false);
  assert.equal(f.calls.some(c => c.model === 'project.task'), false);
});
test('direct and sales-line associations are separate and reread against exact order', async () => {
  for (const p of [
    { ...project, reinvoiced_sale_order_id: false, sale_order_id: [30, 'Order'] },
    { ...project, reinvoiced_sale_order_id: false, sale_line_id: [50, 'Line'] },
  ]) {
    const f = fixture({ projects: [p] });
    const result = await f.run();
    assert.equal(result.status, 'REUSED');
    if (p.sale_line_id) assert.deepEqual(f.calls.at(-1).args, [[['id', '=', 50]]]);
  }
});
test('wrong customer, wrong case, cancelled order and missing order stop before project reads', async () => {
  for (const orders of [[], [order, order], [{ ...order, id: 31 }], [{ ...order, partner_id: [8, 'Other'] }],
    [{ ...order, opportunity_id: false }], [{ ...order, state: 'cancel' }]]) {
    const f = fixture({ orders });
    assert.equal((await f.run()).reason, 'project_order_identity_unverified');
    assert.equal(f.calls.length, 1);
  }
});
test('name match cannot substitute for a relation; wrong, missing and archived customer rejected', async () => {
  for (const p of [
    { ...project, reinvoiced_sale_order_id: false }, { ...project, partner_id: [8, 'Other'] },
    { ...project, active: false }, { ...project, partner_id: false },
    { ...project, sale_order_id: undefined }, { ...project, id: 0 },
  ]) assert.equal((await fixture({ projects: [p] }).run()).status, 'REVIEW_REQUIRED');
});
test('two candidates require review even when one is an exact relation', async () => {
  assert.equal((await fixture({ projects: [project, { ...project, id: 41 }] }).run()).reason, 'project_candidates_ambiguous');
});
test('conflicting direct/billing/line relations never reuse', async () => {
  assert.equal((await fixture({ projects: [{ ...project, sale_order_id: [31, 'Other'] }] }).run()).reason, 'project_relations_conflict');
  for (const lines of [[], [{ id: 51, order_id: [30, 'Order'] }], [{ id: 50, order_id: [31, 'Other'] }]]) {
    assert.equal((await fixture({ projects: [{ ...project, sale_line_id: [50, 'Line'] }], lines }).run()).reason,
      'project_sales_line_order_unverified');
  }
});
test('no candidate defers draft and sent; confirmed orders still need a shared creator', async () => {
  for (const state of ['draft', 'sent', 'sale', 'done']) {
    const result = await fixture({ orders: [{ ...order, state }], projects: [] }).run();
    assert.equal(result.id, null);
    assert.equal(result.status, ['draft', 'sent'].includes(state) ? 'DEFERRED' : 'REVIEW_REQUIRED');
    assert.equal(result.reason, ['draft', 'sent'].includes(state) ? 'project_order_not_confirmed' : 'project_single_writer_not_established');
  }
});
test('missing or incompatible schema and unknown relation shapes require review', async () => {
  for (const fields of [[], schema.filter(f => f.name === 'partner_id'),
    schema.map(f => f.name === 'sale_order_id' ? { ...f, relation: 'wrong.model' } : f)]) {
    const f = fixture({ schema: fields });
    assert.equal((await f.run()).reason, 'project_schema_unverified');
    assert.equal(f.calls.length, 2);
  }
  assert.equal((await fixture({ projects: [{ ...project, sale_order_id: '30' }] }).run()).reason, 'project_relation_unverified');
});
test('read failures are not an empty result and private errors are not exposed', async () => {
  for (const fail of ['sale.order', 'ir.model.fields', 'project.project', 'sale.order.line']) {
    const f = fixture({ fail, projects: [{ ...project, sale_line_id: [50, 'Line'] }] });
    const result = await f.run();
    assert.equal(result.reason, 'project_association_read_unavailable');
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});
test('invalid identities fail closed before transport', async () => {
  for (const id of [0, -1, NaN, 1.5, '30', Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture();
    assert.equal((await f.run({ orderId: id })).reason, 'invalid_project_identity');
    assert.equal(f.calls.length, 0);
  }
});
test('parallel readers and reopened/replayed invocations never become competing creators', async () => {
  const f = fixture({ projects: [], orders: [{ ...order, state: 'sale' }] });
  const results = await Promise.all([f.run(), f.run()]);
  results.push(await fixture({ projects: [], orders: [{ ...order, state: 'sale' }] }).run());
  assert(results.every(r => r.reason === 'project_single_writer_not_established'));
});
