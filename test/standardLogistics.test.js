import test from 'node:test';
import assert from 'node:assert/strict';
import { standardLogisticsLines } from '../src/standardLogistics.js';
test('delivery and collection have separate 100 km minimums', () => {
  for (const [deliveryKm, collectionKm, expected] of [
    [40, 60, [100, 100]], [180, 20, [180, 100]],
    [100, 100, [100, 100]], [140.5, 200, [140.5, 200]], [0, 0, [100, 100]],
  ]) {
    const lines = standardLogisticsLines({ deliveryKm, collectionKm });
    assert.deepEqual(lines.map(line => line[2].product_uom_qty), expected);
    for (const line of lines) {
      assert.equal(line[2].product_id, 7);
      assert.equal(line[2].is_rental, false);
      assert(!('price_unit' in line[2]));
      assert(!('tax_ids' in line[2]));
      assert(!('discount' in line[2]));
    }
  }
});
test('missing, textual or invalid distances cannot become a minimum quote', () => {
  for (const invalid of [undefined, null, '', '100', -1, NaN, Infinity]) {
    assert.throws(() => standardLogisticsLines({ deliveryKm: invalid, collectionKm: 100 }));
    assert.throws(() => standardLogisticsLines({ deliveryKm: 100, collectionKm: invalid }));
  }
});
