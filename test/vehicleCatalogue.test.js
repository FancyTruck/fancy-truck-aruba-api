import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_CATALOGUE, catalogueModelsIn } from '../src/vehicleCatalogue.js';
import { classifyCommercialMessage } from '../src/commercialFilter.js';
import { missingRequestDetails } from '../src/requestDetails.js';
test('all twelve published models are recognized in customer inquiries', () => {
  assert.equal(VEHICLE_CATALOGUE.length, 12);
  for (const [model] of VEHICLE_CATALOGUE) {
    const text = `Vorrei un preventivo per ${model}`;
    assert.deepEqual(catalogueModelsIn(text), [model]);
    assert.equal(classifyCommercialMessage('', text).kind, 'rental');
    assert.equal(missingRequestDetails('rental', '', text).some(question => question.startsWith('modello scelto')), model === 'Ape Car');
  }
});
test('aliases and accented spelling work without substring false matches', () => {
  assert.deepEqual(catalogueModelsIn('Citroen Type H'), ['Citroën Type H']);
  assert.deepEqual(catalogueModelsIn('aperitivo e rapporto'), []);
  assert.deepEqual(catalogueModelsIn('Porter oppure Ducato'), ['Ducato', 'Porter']);
});
