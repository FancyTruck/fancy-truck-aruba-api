import test from 'node:test';
import assert from 'node:assert/strict';
import { selectExactProduct, draftProductLine } from '../src/productSelection.js';
const product = { id: 1, name: 'Airstream', sale_ok: true, rent_ok: true, list_price: 50000 };
test('live rental-only vehicles remain eligible without being enabled for sale', () => {
  const rentalOnly = { id: 40, name: 'Airstream Replica 4m XA855XY', sale_ok: false, rent_ok: true };
  assert.equal(selectExactProduct([rentalOnly], 'Airstream', true)?.id, 40);
  assert.equal(selectExactProduct([rentalOnly], 'Airstream', false), null);
  assert.equal(selectExactProduct([{ ...rentalOnly, rent_ok: false }], 'Airstream', true), null);
});
test('two verified Citroen vehicles require a choice; Airstream does not select the 9m model', () => {
  const vehicles = [
    { id: 163, name: 'Citroen Type H EX826XR', rent_ok: true, sale_ok: false },
    { id: 14, name: 'Citroen Type H ZB896AE', rent_ok: true, sale_ok: false },
  ];
  assert.equal(selectExactProduct(vehicles, 'Citroen HY', true), null);
  assert.equal(selectExactProduct([{ id: 180, name: 'Airstream Overlander 1963 9m', rent_ok: true }], 'Airstream', true), null);
  assert.equal(selectExactProduct([{ id: 31, name: 'Volkswagen T1 ZA201RN', rent_ok: true, sale_ok: false }], 'Bulli', true)?.id, 31);
});
test('unique exact eligible product is selected but similar names and duplicates are not', () => {
  assert.equal(selectExactProduct([product], 'Airstream', true)?.id, 1);
  assert.equal(selectExactProduct([{ ...product, name: 'Airstream accessori' }], 'Airstream', true), null);
  assert.equal(selectExactProduct([product, { ...product, id: 2 }], 'Airstream', true), null);
  assert.equal(selectExactProduct([{ ...product, rent_ok: false }], 'Airstream', true), null);
  assert.equal(selectExactProduct([product], '', true), null);
});
test('catalogue spelling variants are exact model aliases', () => {
  assert.equal(selectExactProduct([{ ...product, name: 'Citroën Type H' }], 'Citroen HY', true)?.id, 1);
});
test('rental never uses product list price as rental tariff', () => {
  const line = draftProductLine(product, true, 'Due giorni a Milano')[2];
  assert.equal(line.display_type, 'line_note');
  assert.equal(line.price_unit, undefined);
  assert.match(line.name, /Tariffa noleggio da verificare/);
});
test('sale draft requires a positive finite price; missing product stays a note', () => {
  assert.equal(draftProductLine(product, false, '')[2].price_unit, 50000);
  assert.equal(draftProductLine({ ...product, list_price: NaN }, false, '')[2].display_type, 'line_note');
  assert.equal(draftProductLine(null, false, '')[2].display_type, 'line_note');
});

test('observed Odoo variants require matching ID, full name and current rental eligibility', () => {
  const observed = { id: 40, name: 'Airstream Replica 4m XA855XY', sale_ok: true, rent_ok: true };
  assert.equal(selectExactProduct([observed], 'Airstream', true)?.id, 40);
  assert.equal(selectExactProduct([{ ...observed, id: 99 }], 'Airstream', true), null);
  assert.equal(selectExactProduct([{ ...observed, name: 'Airstream Replica 4m diverso' }], 'Airstream', true), null);
  assert.equal(selectExactProduct([{ ...observed, rent_ok: false }], 'Airstream', true), null);
  assert.equal(selectExactProduct([observed, product], 'Airstream', true), null);
});

test('generic Horse Trailer does not select Vintage even when it is the sole result', () => {
  const vintage = { id: 46, name: 'Horse Trailer Vintage GE030793', sale_ok: true, rent_ok: true };
  assert.equal(selectExactProduct([vintage], 'Horse Trailer', true), null);
  assert.equal(selectExactProduct([vintage], 'Horse Trailer Vintage', true)?.id, 46);
});
test('generic Ape Car does not select a specific Ape', () => {
  const ape = { id: 60, name: 'Piaggio Ape Classic Lineare BJ49780', sale_ok: true, rent_ok: true };
  assert.equal(selectExactProduct([ape], 'Ape Car', true), null);
});
