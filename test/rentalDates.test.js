import test from 'node:test';
import assert from 'node:assert/strict';
import {italianRentalDates} from '../src/rentalDates.js';
test('Italian customer times convert to UTC for native Odoo pricing',()=>{
  assert.deepEqual(italianRentalDates('20/12/2026 al 21/12/2026 dalle 10:00 alle 18:00'),{start:'2026-12-20 09:00:00',end:'2026-12-21 17:00:00'});
  assert.deepEqual(italianRentalDates('20/07/2026 al 21/07/2026 dalle 10:00 alle 18:00'),{start:'2026-07-20 08:00:00',end:'2026-07-21 16:00:00'});
});
test('invalid, ambiguous or conflicting periods are left for review',()=>{
  for(const text of ['31/02/2026 al 03/03/2026 10:00 18:00','29/03/2026 al 30/03/2026 02:30 10:00',
    '25/10/2026 al 26/10/2026 02:30 10:00','21/12/2026 al 20/12/2026 10:00 18:00',
    '20/12/2026 al 21/12/2026 10:00 18:00, oppure 22/12/2026']) assert.equal(italianRentalDates(text),null);
});
