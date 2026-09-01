import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMERCIAL_PROCEDURE, missingDraftData, normalizeCompanyName, sameCommercialCase,
} from '../src/commercialProcedure.js';

test('la procedura chat espone i vincoli approvati', () => {
  assert.equal(COMMERCIAL_PROCEDURE.incomplete_request.status, 'Da integrare');
  assert.match(COMMERCIAL_PROCEDURE.creation_rules.partner, /ragione sociale o partita IVA/);
  assert.match(COMMERCIAL_PROCEDURE.pietro_control.rule, /conferma finale di Pietro/);
});

test('la bozza resta bloccata senza cliente identificato, personalizzazione e budget', () => {
  const missing = missingDraftData({
    customer: { name: 'Mario', email: 'mario@example.test' },
    request: { service: 'rental', asset: 'Ape', location: 'Milano', start_at: '2026-09-10', duration: '1 giorno' },
  });
  assert.ok(missing.includes('customer.company_or_vat'));
  assert.ok(missing.includes('personalization'));
  assert.ok(missing.includes('budget'));
});

test('ragione sociale e dominio riconoscono la stessa pratica', () => {
  assert.equal(normalizeCompanyName('Fancy Truck S.r.l.'), 'fancy truck');
  assert.equal(sameCommercialCase({
    customer: { company_name: 'Cliente S.r.l.', email: 'mario@cliente.it' },
    request: { location: 'Milano', start_at: '2026-09-10' }, normalized_subject: 'preventivo evento',
  }, {
    customer: { company_name: 'Cliente SRL', email: 'anna@cliente.it' },
    request: { location: 'Milano', start_at: '2026-09-10' }, normalized_subject: 'Re: Preventivo evento',
  }), true);
});
