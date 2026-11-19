import test from 'node:test';import assert from 'node:assert/strict';
import {customerActions,customerTag} from '../src/customerActions.js';
const lead=id=>({id,name:'Cliente '+id,active:true,stage_id:[1,'Nuove richieste']});
const activity=(id,res_id,date_deadline='2026-11-19')=>({id,res_id,date_deadline,summary:'Verificare la proposta',write_date:'2026-11-19 12:00:00'});
test('only verified active customer activities, at most one per customer and three per page',async()=>{
 const calls=[],leads=[lead(1),lead(2),lead(3),lead(4),{...lead(5),active:false},{...lead(6),name:'COLLAUDO FANCY AI'},{...lead(7),stage_id:[13,'Stand-by']}];
 const read=async(...a)=>{calls.push(a);return a[0]==='crm.lead'?leads:[activity(1,1),activity(2,1),activity(3,2),activity(4,3),activity(5,4),activity(6,5),activity(7,6),activity(8,7),activity(9,999)];};
 const first=await customerActions(read,{limit:3});assert.equal(first.total,4);assert.equal(first.actions.length,3);assert.deepEqual(first.actions.map(a=>a.opportunity_id),[1,2,3]);assert.ok(calls[0][1].some(d=>d[0]==='tag_ids.name'&&d[2]===customerTag));
 const second=await customerActions(read,{after:first.next_after});assert.deepEqual(second.actions.map(a=>a.opportunity_id),[4]);assert.equal(second.next_after,null);
 // Removing an earlier completed activity does not skip the next customer.
 const later=await customerActions(async m=>m==='crm.lead'?leads:[activity(3,2),activity(4,3),activity(5,4)],{after:first.next_after});assert.equal(later.actions[0].opportunity_id,4);
});
test('read-only snapshot rejects truncation and malformed results instead of reporting no work',async()=>{
 await assert.rejects(customerActions(async()=>Array.from({length:501},(_,i)=>lead(i+1))),/customer_actions_incomplete/);
 await assert.rejects(customerActions(async m=>m==='crm.lead'?[lead(1)]:null),/customer_actions_incomplete/);
});
test('signature ignores write metadata but changes when the next customer action changes',async()=>{
 let rows=[activity(1,1)];const read=async m=>m==='crm.lead'?[lead(1)]:rows;
 const first=await customerActions(read);rows[0].write_date='later';assert.equal((await customerActions(read)).signature,first.signature);
 rows[0].summary='Inviare proposta aggiornata';assert.notEqual((await customerActions(read)).signature,first.signature);
});
