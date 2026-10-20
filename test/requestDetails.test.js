import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommercialMessage } from '../src/commercialFilter.js';
import { missingRequestDetails } from '../src/requestDetails.js';
import { routeCommercialMessage } from '../src/commercialRouting.js';

test('event inquiry starts data collection without assuming rental or asking for Milan again', async () => {
  const text = 'Buongiorno, possiamo avere informazioni per un evento a Milano?';
  const classification = classifyCommercialMessage('Informazioni', text);
  assert.equal(classification.kind, 'unknown');
  const decision = await routeCommercialMessage({ parsed: { subject: 'Informazioni', text,
    from: { value: [{ address: 'cliente@example.com' }] } }, account: 'hello', uid: 1,
    store: { queueClassification() { throw new Error('Must not queue a clear inquiry'); } }, findLead: async () => ({}) });
  assert.deepEqual(decision, { action: 'create', kind: 'unknown' });
  const missing = missingRequestDetails(decision.kind, 'Informazioni', text);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /servizio richiesto/);
  assert.ok(!missing.some(value => /luogo|veicolo/.test(value)));
});
test('provided date, event type and location are retained', () => {
  const missing = missingRequestDetails('unknown', '', 'Evento aziendale a Milano il 20/12/2026 per 4 ore. Budget 2000 euro.');
  assert.equal(missing.length, 1);
  assert.match(missing[0], /servizio richiesto/);
});
test('newsletter and supplier event offers remain excluded', () => {
  assert.equal(classifyCommercialMessage('Newsletter', 'Informazioni per un evento a Milano', new Map([['list-id','bulk']])).kind, null);
  assert.equal(classifyCommercialMessage('Proposta', 'Offriamo servizi per eventi. Richiedi informazioni.').kind, null);
});
