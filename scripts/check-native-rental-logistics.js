// Authorized operational test: test customer only, draft orders only, no sends.
// Run on Render: node scripts/check-native-rental-logistics.js
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { standardLogisticsLines } from '../src/standardLogistics.js';
const marker = 'FANCY-AI-COLLAUDO-20261021-NATIVE';
const reportPath = '/var/data/fancy-native-logistics-test.json';
const report = { marker, started_at: new Date().toISOString(), scenarios: [], status: 'STARTED' };
const save = () => {
  fs.writeFileSync(`${reportPath}.tmp`, JSON.stringify(report, null, 2), { mode: 0o600 });
  fs.renameSync(`${reportPath}.tmp`, reportPath);
};
const api = async (model, method, body) => {
  assert(['search_read', 'create'].includes(method));
  if (method === 'create') {
    assert.equal(model, 'sale.order');
    assert.equal(body.vals_list.length, 1);
    const values = body.vals_list[0];
    assert(values.client_order_ref.startsWith(marker));
    assert.equal(values.partner_id, report.partner_id);
    assert.equal(values.state, 'draft');
    for (const [, , line] of values.order_line) {
      assert([7, 40].includes(line.product_id));
      assert(!('price_unit' in line));
    }
  }
  const response = await fetch(`${process.env.ODOO_URL.replace(/\/$/, '')}/json/2/${model}/${method}`, {
    method: 'POST', headers: { authorization: `bearer ${process.env.ODOO_API_KEY}`,
      'x-odoo-database': process.env.ODOO_DB, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Odoo ${model}.${method}: HTTP ${response.status}`);
  return response.json();
};
const read = (model, domain, fields) => api(model, 'search_read', { domain, fields, limit: 20 });
try {
  process.umask(0o077);
  assert(!fs.existsSync(reportPath), 'Collaudo gia avviato: leggere il report, non ricreare le bozze');
  const leads = await read('crm.lead', [['id', '=', 503]], ['name', 'email_from', 'partner_id']);
  assert.equal(leads.length, 1);
  assert(leads[0].name.startsWith('[FANCY-AI-COLLAUDO-20261021 / NOLEGGIO]'));
  assert.equal(leads[0].email_from, 'grafichefancytruck@gmail.com');
  assert(leads[0].partner_id);
  const partners = await read('res.partner', [['id', '=', leads[0].partner_id[0]]], ['name', 'email', 'property_product_pricelist']);
  assert.equal(partners.length, 1);
  assert.equal(partners[0].name, 'COLLAUDO FANCY AI');
  assert.equal(partners[0].email, 'grafichefancytruck@gmail.com');
  assert.equal(partners[0].property_product_pricelist[0], 1);
  report.partner_id = partners[0].id;
  const products = await read('product.product', [['id', 'in', [7, 40]]], ['name', 'list_price', 'rent_ok', 'sale_ok']);
  assert.equal(products.length, 2);
  assert.equal(products.find(p => p.id === 7).list_price, 2);
  assert.equal(products.find(p => p.id === 40).rent_ok, true);
  const rules = await read('product.pricelist.item', [['id', '=', 6]], ['pricelist_id', 'product_tmpl_id', 'compute_price', 'fixed_price']);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].pricelist_id[0], 1);
  assert.equal(rules[0].product_tmpl_id[0], 7);
  assert.equal(rules[0].compute_price, 'fixed');
  assert.equal(rules[0].fixed_price, 2);
  const previous = await read('sale.order', [['client_order_ref', '=like', `${marker}%`]], ['name', 'state']);
  assert.equal(previous.length, 0, 'Bozze test gia esistenti: non duplicarle');
  fs.writeFileSync(reportPath, JSON.stringify(report), { flag: 'wx', mode: 0o600 });
  for (const scenario of [
    { name: 'MINIMI', deliveryKm: 40, collectionKm: 60, quantities: [100, 100], expected: 400 },
    { name: 'ASIMMETRICO', deliveryKm: 180, collectionKm: 20, quantities: [180, 100], expected: 560 },
    { name: 'SOPRA-MINIMI', deliveryKm: 150, collectionKm: 200, quantities: [150, 200], expected: 700 },
  ]) {
    // Synthetic test distances, not an estimate of a real customer journey.
    const result = { ...scenario, status: 'CREATING', client_order_ref: `${marker}-${scenario.name}` };
    report.scenarios.push(result); save();
    const ids = await api('sale.order', 'create', { vals_list: [{
      partner_id: report.partner_id, pricelist_id: 1, state: 'draft',
      client_order_ref: result.client_order_ref, origin: 'COLLAUDO FANCY AI - NON INVIARE',
      is_rental_order: true,
      // Exactly 24 hours, explicitly UTC; native Odoo computes rental price.
      rental_start_date: '2026-12-20 09:00:00', rental_return_date: '2026-12-21 09:00:00',
      order_line: [[0, 0, { product_id: 40, product_uom_qty: 1, is_rental: true }],
        ...standardLogisticsLines(scenario)],
    }] });
    result.order_id = Array.isArray(ids) ? ids[0] : ids; save();
    const orders = await read('sale.order', [['id', '=', result.order_id]], ['name', 'state', 'pricelist_id', 'is_rental_order', 'rental_start_date', 'rental_return_date', 'amount_untaxed', 'amount_total']);
    assert.equal(orders.length, 1);
    result.order = orders[0]; save();
    assert.equal(result.order.state, 'draft');
    assert.equal(result.order.pricelist_id[0], 1);
    const lines = await read('sale.order.line', [['order_id', '=', result.order_id]], ['product_id', 'name', 'product_uom_qty', 'is_rental', 'price_unit', 'discount', 'price_subtotal', 'price_total']);
    result.lines = lines; save();
    const logistics = lines.filter(l => l.product_id?.[0] === 7);
    const rental = lines.filter(l => l.product_id?.[0] === 40);
    assert.equal(logistics.length, 2);
    assert.deepEqual(logistics.map(l => l.product_uom_qty).sort((a,b)=>a-b), [...scenario.quantities].sort((a,b)=>a-b));
    for (const line of logistics) { assert.equal(line.price_unit, 2); assert.equal(line.discount, 0); assert.equal(line.is_rental, false); }
    assert.equal(logistics.reduce((sum, line) => sum + line.product_uom_qty * line.price_unit, 0), scenario.expected);
    assert.equal(rental.length, 1);
    assert.equal(rental[0].is_rental, true);
    assert(rental[0].price_unit > 0, 'Tariffa nativa noleggio non calcolata');
    // This is a native-price probe, not independent certification of the rental rate.
    result.status = 'LOGISTICS_VERIFIED_RENTAL_RATE_TO_REVIEW'; save();
    console.log(JSON.stringify({ scenario: scenario.name, bozza: result.order.name,
      logistica: scenario.expected, noleggio_calcolato_da_odoo: rental[0].price_unit,
      stato: result.order.state }));
  }
  report.status = 'LOGISTICS_PASSED_RENTAL_RATE_TO_REVIEW'; save();
  console.log('MINIMI LOGISTICA: 3/3; BOZZE NON INVIATE. Report:', reportPath);
} catch (error) {
  if (fs.existsSync(reportPath) && report.scenarios.length) {
    report.status = 'INCOMPLETE_DO_NOT_RETRY'; report.error = error.message; save();
  }
  console.error('COLLAUDO INCOMPLETO, NON RIPETERE:', error.message);
  process.exitCode = 1;
}
