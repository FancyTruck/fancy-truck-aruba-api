import assert from 'node:assert/strict';
import test from 'node:test';
import { explicitCompanyName, partnerValuesFromAutocomplete, selectCertainAutocompleteResult } from '../src/partnerEnrichment.js';

test('estrae la ragione sociale solo da un campo esplicito', () => {
  assert.equal(explicitCompanyName('Ragione sociale: Azienda Demo S.r.l.\nTelefono: 010'), 'Azienda Demo S.r.l.');
  assert.equal(explicitCompanyName('Vorrei un preventivo per la mia azienda'), null);
});

test('usa solo una corrispondenza univoca per partita IVA o ragione sociale', () => {
  const rows = [{ name: 'Azienda Demo SRL', vat: 'IT12345670546', city: 'Genova' }];
  assert.equal(selectCertainAutocompleteResult(rows, { vat: '12345670546' }), rows[0]);
  assert.equal(selectCertainAutocompleteResult(rows, { companyName: 'Azienda Demo S.R.L.' }), rows[0]);
  assert.equal(selectCertainAutocompleteResult([...rows, rows[0]], { vat: '12345670546' }), null);
});

test('non sovrascrive i dati certi già presenti nel contatto', () => {
  const values = partnerValuesFromAutocomplete(
    { name: 'Azienda Demo SRL', vat: 'IT12345670546', city: 'Genova', zip: '16121', country_id: { id: 110 } },
    { city: 'Milano' },
  );
  assert.equal(values.city, undefined);
  assert.equal(values.zip, '16121');
  assert.equal(values.country_id, 110);
  assert.equal(values.company_type, 'company');
});
