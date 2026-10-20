import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyRentalBookings, unavailableVehicleAction } from '../src/rentalAvailability.js';
import { JsonStateStore } from '../src/store.js';
import { ApprovalService } from '../src/policy.js';
test('quotes and options never make a vehicle definitively unavailable', () => {
  const result = classifyRentalBookings([{state:'draft'},{state:'sent',validity_date:'2026-10-21',signed_on:false}], {now:new Date('2026-10-21T10:00:00Z')});
  assert.equal(result.status, 'OPTIONED'); assert.equal(result.definitive.length, 0);
});
test('confirmed booking overrides options and cancelled orders do not block', () => {
  assert.equal(classifyRentalBookings([{state:'sent'},{state:'sale'}]).status, 'UNAVAILABLE');
  assert.equal(classifyRentalBookings([{state:'done'}]).status, 'UNAVAILABLE');
  assert.equal(classifyRentalBookings([{state:'cancel'}]).status, 'NO_CONFIRMED_BOOKING');
});
test('unknown states and truncated search never promise availability', () => {
  assert.equal(classifyRentalBookings([{state:'custom_option'}]).status,'UNKNOWN');
  assert.equal(classifyRentalBookings([], {complete:false}).checked,false);
});
test('unavailable vehicle queues a customer choice, with no automatic sending or invented alternatives', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fancy-alternatives-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new JsonStateStore(path.join(dir,'state.json'));const approvals=new ApprovalService(store,'test');
  const input=unavailableVehicleAction({leadId:42,recipient:'cliente@example.com',product:{id:40,name:'Airstream'},dates:{start:'2026-12-12',end:'2026-12-14'}});
  const first=approvals.queue(input); const second=approvals.queue(input);
  assert.equal(first.action.status,'PENDING_APPROVAL');assert.equal(second.duplicate,true);
  assert.match(first.action.payload.text,/modello alternativo/);
  assert.match(first.action.payload.text,/Verificheremo la disponibilità/);
  assert.throws(()=>approvals.assertExecutable(first.action.id));
});

const now = new Date('2026-10-21T10:00:00Z');
test('only sent unexpired unsigned quotes are options; drafts and expired quotes are ignored', () => {
  const result = classifyRentalBookings([
    {id:1,state:'sent',validity_date:'2026-10-21',signed_on:false},
    {id:2,state:'sent',validity_date:'2026-10-20',signed_on:false},
    {id:3,state:'draft',validity_date:'2026-11-01',signed_on:false},
  ], {now});
  assert.deepEqual(result.options.map(row=>row.id), [1]);
  assert.deepEqual(result.ignored.map(row=>row.id), [2,3]);
});
test('signature or missing expiry/signature evidence requires reconciliation', () => {
  for (const quote of [
    {validity_date:'2026-11-01',signed_on:'2026-10-20 10:00:00'},
    {validity_date:false,signed_on:false},
    {validity_date:'2026-11-01'},
    {validity_date:'2026-02-30',signed_on:false},
  ]) assert.equal(classifyRentalBookings([{state:'sent',...quote}],{now}).status,'UNKNOWN');
});
test('quote expires at local Rome midnight rather than UTC midnight', () => {
  const quote={state:'sent',validity_date:'2026-10-21',signed_on:false};
  assert.equal(classifyRentalBookings([quote],{now:new Date('2026-10-21T21:59:00Z')}).status,'OPTIONED');
  assert.equal(classifyRentalBookings([quote],{now:new Date('2026-10-21T22:01:00Z')}).status,'NO_CONFIRMED_BOOKING');
});
