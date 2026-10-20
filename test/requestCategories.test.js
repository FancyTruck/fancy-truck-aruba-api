import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommercialMessage as classify } from '../src/commercialFilter.js';
import { missingRequestDetails as missing, requiredRequestDetails as required, REQUEST_CATEGORIES } from '../src/requestDetails.js';
test('four intake categories remain distinct', () => {
  for (const [text, kind] of [['Vorremmo partecipare a un evento food', 'event_food'], ['Vorrei un preventivo catering', 'catering'], ['Vorrei un preventivo noleggio foodtruck', 'rental'], ['Richiesta brand activation', 'brand_activation']]) assert.equal(classify('', text).kind, kind);
  assert.equal(REQUEST_CATEGORIES.event_food.contact, 'cristiano@fancytruck.it');
  assert.deepEqual(missing('event_food', '', ''), []);
});
test('catering asks its own details, with optional budget', () => {
  const questions = missing('catering', '', '');
  for (const label of ['numero di ospiti','durata del servizio','numero di foodtruck','servizio desiderato']) assert.ok(questions.includes(label));
  assert.ok(questions.some(q => /budget.*facoltativo/.test(q)));
  assert.ok(!required('catering', '', '').some(q => /budget/.test(q)));
  assert.deepEqual(required('catering', '', 'Catering il 20/12/2026 a Milano per 80 ospiti, 4 ore, 2 foodtruck. Cena.'), []);
});
test('rental needs a specific model and start/end times, not budget', () => {
  const questions = missing('rental', '', 'Noleggio foodtruck a Milano il 20/12/2026');
  assert.ok(questions.some(q => /modello/.test(q)));
  assert.ok(questions.some(q => /date di inizio/.test(q)));
  assert.ok(questions.some(q => /orari/.test(q)));
  assert.ok(!questions.some(q => /budget/.test(q)));
  assert.deepEqual(required('rental', '', 'Fiat 238 a Milano dal 20/12/2026 al 21/12/2026 dalle 10:00 alle 18:00. Personalizzazioni: nessuna. Attrezzature: nessuna. Allestimenti: nessuno. Richieste particolari: nessuna.'), []);
});
test('brand activation includes responsibility questions without mandatory concept', () => {
  const questions = missing('brand_activation', '', '');
  for (const term of ['staff','gestione','permessi','adempimenti','allestimenti','personalizzazioni']) assert.ok(questions.some(q => q.includes(term)));
  assert.ok(!required('brand_activation', '', '').some(q => /concept/.test(q)));
  assert.ok(!questions.some(q => /budget/.test(q)));
});

test('generic Horse Trailer asks for the variant', () => {
  const questions = missing('rental', '', 'Vorrei noleggiare un Horse Trailer');
  assert.ok(questions.includes('variante Horse Trailer desiderata: Legno o Vintage'));
  assert.ok(!missing('rental', '', 'Horse Trailer Vintage').some(q => /variante Horse/.test(q)));
});
