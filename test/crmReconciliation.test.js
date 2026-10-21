import test from 'node:test';
import assert from 'node:assert/strict';
import { nonCommercialCrmReason, reconcileCrm } from '../src/crmReconciliation.js';
import { routeCommercialMessage } from '../src/commercialRouting.js';
test('clear notifications never reach CRM lookup even with commercial keywords in footer',async()=>{
 for(const subject of ['Spedito: Acquisto Amazon','New login to Instagram from Chrome','Il tuo estratto conto è pronto']){
  const result=await routeCommercialMessage({parsed:{subject,text:'Richiesta preventivo noleggio food truck',from:{value:[{address:'notification@example.com'}]}},
   store:{queueClassification(){throw Error('Unexpected review');}},findLead(){throw Error('Unexpected Odoo access');}});
  assert.equal(result.action,'skip');
 }
});
test('commercial, operational and forwarded threads are not bulk-archivable',()=>{
 for(const subject of ['Noleggio container vetrati','R: Fattura catering','Fwd: Spedito: Foodtruck','Consegna Airstream','Comunicazione orari truck','Richiesta preventivo'])assert.equal(nonCommercialCrmReason(subject),null);
});
test('archive backs up first, preserves quotes and cancels only associated pending approvals',async()=>{
 const writes=[];let saved=false;
 const leads=[{id:1,name:'Spedito: Articolo',active:true,write_date:'date',stage_id:[1,'Nuove richieste']},
 {id:2,name:'Spedito: Articolo protetto',active:true,write_date:'date',stage_id:[1,'Nuove richieste']}];
 const store={state:{actions:{a:{case_id:'odoo-lead-1',status:'PENDING_APPROVAL'},b:{case_id:'odoo-lead-2',status:'PENDING_APPROVAL'},c:{case_id:'odoo-lead-1',status:'EXECUTED'}},cases:{}},save(){saved=true;},audit(){},remember(){}};
 const call=async(model,method,args,options)=>{
  if(model==='crm.stage')return [{id:1,name:'Nuove richieste'}];
  if(model==='sale.order')return args[0][0][2]===2?1:0;
  if(method==='write'){assert(saved);assert(store.state.crm_archive_backups[1]);writes.push(args);return true;}
  if(options.context?.active_test===false)return [{id:1,active:false}];
  if(options.fields.length===1)return [{id:1}];
  return leads;
 };
 const result=await reconcileCrm({call,store});
 assert.equal(result.archived,1);assert.equal(result.protected,1);
 assert.deepEqual(writes,[[[1],{active:false}]]);
 assert.equal(store.state.actions.a.status,'CANCELLED');assert.equal(store.state.actions.b.status,'PENDING_APPROVAL');assert.equal(store.state.actions.c.status,'EXECUTED');
});
