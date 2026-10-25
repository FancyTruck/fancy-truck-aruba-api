import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {makePeuContract} from '../src/peuContract.js';
import {hash} from '../src/peuCommon.js';
function fixture(){const db=new DatabaseSync(':memory:'),calls=[];const contract=makePeuContract({db,approvals:{store:{state:{}}},assertWritable:()=>{throw Error('write forbidden');},upstream:()=>{throw Error('unexpected upstream');},odooRead:async(...args)=>{calls.push(args);return Array.from({length:3},(_,i)=>({id:i+1,name:'record'}));}});const execute=(capability,parameters)=>{const c=contract.catalog().capabilities.find(x=>x.id===capability);return contract.execute({operation_id:'test',idempotency_key:'test',capability,parameters,confirmation:{payload_hash:hash({provider:'fancy',capability,domain:'work',payload:{parameters,catalog_hash:hash(c)},effect:c.effect,confirmation:c.confirmation})}});};return{db,calls,contract,execute};}
test('bounded sales search is read-only, reports truncation and preserves business protections',async()=>{const f=fixture();const r=await f.execute('sales.list',{partner_id:42,limit:2});assert.equal(r.result.records.length,2);assert.equal(r.result.has_more,true);assert.deepEqual(f.calls[0][1],[['partner_id','=',42]]);assert.equal(f.calls[0][0],'sale.order');assert.equal(f.calls[0][2].limit,3);assert.equal(f.contract.catalog().capabilities.find(x=>x.id==='mail.send').confirmation,true);assert.equal(f.contract.catalog().capabilities.find(x=>x.id==='quote.prepare').confirmation,true);await f.execute('sales.list',{partner_id:42,limit:2});assert.equal(f.calls.length,1);f.db.close();});
test('unknown fields, excessive limit and write methods cannot reach Odoo',async()=>{for(const p of [{model:'res.users'},{limit:999},{method:'unlink'},{partner_id:-1}]){const f=fixture();await assert.rejects(f.execute('sales.list',p));assert.equal(f.calls.length,0);f.db.close();}});
test('sales detail lines are restricted to the selected order',async()=>{const f=fixture();await f.execute('sales.get',{id:99});assert.equal(f.calls[1][0],'sale.order.line');assert.deepEqual(f.calls[1][1],[['order_id','=',99]]);assert.equal(f.calls[1][2].limit,51);f.db.close();});

test('ongoing rentals exclude quotations and cancelled records, preserve undated and return vehicle lines',async()=>{
 const {readOdoo}=await import('../src/peuOdooRead.js');const calls=[];
 const r=await readOdoo(async(...a)=>{calls.push(a);return a[0]==='sale.order'?[{id:42,rental_start_date:'2026-10-24 08:00:00',rental_return_date:'2026-10-26 08:00:00'},{id:43,rental_start_date:false,rental_return_date:false}]:[{id:1,order_id:[42,'S42'],product_id:[1,'Truck']}];},'rentals.list',{},new Date('2026-10-25T12:00:00Z'));
 assert.ok(calls[0][1].some(x=>JSON.stringify(x)==='["state","=","sale"]'));assert.ok(calls[0][1].includes('|'));
 assert.deepEqual(calls[0][1].at(-1),['rental_return_date','>','2026-10-25 12:00:00']);assert.equal(r.records[0].period_status,'current');assert.equal(r.records[1].period_status,'dates_missing');assert.deepEqual(calls[1][1],[['order_id','in',[42,43]],['is_rental','=',true]]);
});
test('current and upcoming rentals apply date boundaries in UTC and support bounded pagination',async()=>{
 const {readOdoo}=await import('../src/peuOdooRead.js');
 for(const scope of ['current','upcoming']){let query;await readOdoo(async(...a)=>{query=a;return [];},'rentals.list',{scope,offset:20,limit:10},new Date('2026-10-25T12:00:00Z'));assert.equal(query[2].offset,20);assert.ok(query[1].some(x=>x[0]==='rental_start_date'&&x[1]===(scope==='current'?'<=':'>')));}
});
test('Rome calendar week handles both DST changes and Sunday correctly',async()=>{
 const {rentalWeek}=await import('../src/peuRentalSchedule.js');
 assert.deepEqual(rentalWeek(new Date('2026-10-25T18:00:00Z')),{start_date:'2026-10-26',end_date_exclusive:'2026-11-02',starts_at:'2026-10-25 23:00:00',ends_at:'2026-11-01 23:00:00',timezone:'Europe/Rome'});
 const spring=rentalWeek(new Date('2026-03-25T12:00:00Z'),'this_week');assert.equal(spring.starts_at,'2026-03-22 23:00:00');assert.equal(spring.ends_at,'2026-03-29 22:00:00');
 const autumn=rentalWeek(new Date('2026-10-23T12:00:00Z'),'this_week');assert.equal(autumn.starts_at,'2026-10-18 22:00:00');assert.equal(autumn.ends_at,'2026-10-25 23:00:00');
});
test('schedule includes only boundaries in range and never calls shipping address confirmed',async()=>{
 const {readRentalSchedule}=await import('../src/peuRentalSchedule.js');
 const result=await readRentalSchedule(async model=>model==='sale.order'?[{id:4,name:'S4',partner_id:[1,'Client'],partner_shipping_id:[1,'Client'],rental_start_date:'2026-10-26 08:00:00',rental_return_date:'2026-11-10 08:00:00'}]:model==='sale.order.line'?[{id:1,order_id:[4,'S4'],name:'Consegna presso Fiera Bologna',is_rental:false}]:[{id:1,street:'Sede amministrativa'}],{},new Date('2026-10-25T18:00:00Z'));
 assert.equal(result.events.length,1);assert.equal(result.events[0].kind,'rental_start');assert.match(result.events[0].location_evidence[0].text,/Bologna/);assert.equal(result.events[0].shipping_address_candidate.street,'Sede amministrativa');assert.match(result.meaning,/non è un luogo confermato/);
});
