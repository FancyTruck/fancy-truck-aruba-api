import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommercialMessage as classify } from '../src/commercialFilter.js';

for (const [subject, body] of [
  ['Il tuo ordine è stato spedito', 'Gentile Fancy Truck, pacco in viaggio'],
  ['Nuovo documento disponibile', 'Accedi al tuo account'],
  ['Conferma del tuo ordine su SmarterStore.it', 'Fancy Truck'],
  ['RE: FATTURA NUMERO ORDINE', 'Richiesta fattura noleggio truck'],
  ['Preventivi riparazione fiat 238 e porter', 'Preventivo veicolo'],
  ['Aruba.it – Risoluzione richiesta assistenza', 'Fancy Truck'],
  ['Newsletter', 'Richiedi un preventivo noleggio truck. Disiscriviti'],
  ['Saluti', 'Grazie\n-- \nRichiesta preventivo food truck'],
  ['Saluti', 'Grazie\nIl giorno lunedì Mario ha scritto:\nRichiesta preventivo food truck'],
  ['Saluti', 'Grazie\n> Richiesta preventivo food truck'],
  ['Richiesta assistenza', 'Gentile Fancy Truck'],
]) {
  test(`exclude: ${subject} / ${body.slice(0, 25)}`, () => {
    assert.equal(classify(subject, body).kind, null);
  });
}
for (const [subject, body, kind] of [
  ['Noleggio bar truck | Christmas Radio Italia', 'Vorremmo informazioni e una quotazione', 'rental'],
  ['Evento Milano', 'Vorrei un preventivo per un food truck', 'rental'],
  ['Richiesta', 'Cerchiamo un Airstream per dicembre', 'rental'],
  ['Roadtour', 'Richiesta preventivo per brand activation', 'brand_activation'],
  ['Re: Preventivo horsebox', 'Grazie, confermo', 'rental'],
]) {
  test(`admit: ${subject}`, () => assert.equal(classify(subject, body).kind, kind));
}
test('bulk header overrides commercial wording', () => {
  assert.equal(classify('Richiesta preventivo truck', '', new Map([['list-id', 'campaign']])).kind, null);
});
test('automated reply is excluded', () => {
  assert.equal(classify('Re: Preventivo truck', '', new Map([['auto-submitted', 'auto-replied']])).kind, null);
});
test('ordinary reply remains available for existing-case routing', () => {
  assert.equal(classify('Re: Dettagli', 'Il luogo è Milano').reason, 'commercial_intent_not_established');
});

test('supplier sales pitch does not create an opportunity', () => {
  assert.equal(classify('Proposta di collaborazione', 'Offriamo noleggio food truck. Richiedi un preventivo.').kind, null);
});
test('forwarded existing quote requires review instead of a new opportunity', () => {
  assert.equal(classify('Fwd: Preventivo food truck', 'Ti inoltro il preventivo già ricevuto.').reason, 'forward_requires_review');
});
test('an explicit new customer request accompanying a forward remains valid', () => {
  assert.equal(classify('Fwd: Food truck', 'Vorrei un preventivo per noleggiare un food truck a Milano.').kind, 'rental');
});
test('signature service and intent are not treated as a request', () => {
  assert.equal(classify('Saluti', 'Grazie\nCordiali saluti\nMario\nNoleggio food truck - richiedi informazioni').kind, null);
});
test('purchase request follows sales instead of rental', () => {
  assert.equal(classify('Richiesta acquisto food truck', 'Vorrei acquistare un food truck.').kind, 'sale');
});
test('rental request remains rental', () => {
  assert.equal(classify('Richiesta noleggio Fiat 238', 'Vorrei un preventivo per il Fiat 238.').kind, 'rental');
});
