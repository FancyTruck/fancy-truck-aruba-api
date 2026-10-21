import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationReferences,matchQuotationThread} from '../src/threadReferences.js';
test('recognizes exact quotation tokens without partial matches',()=>{
 assert.deepEqual(quotationReferences('Nuovo oggetto s00321','S00321 XS00322 S003210X'),['S00321']);
});
test('same customer and quotation can identify a case despite a different subject',async()=>{
 const result=await matchQuotationThread({subject:'Aggiornamento consegna',text:'Per S00321',partnerIds:[7],call:async(model,method,args)=>{
  assert.equal(method,'search_read');
  if(model==='sale.order'){assert.deepEqual(args[0][1],['partner_id','in',[7]]);return [{id:321,name:'S00321',partner_id:[7,'Cliente'],opportunity_id:[42,'Caso']}];}
  return [{id:42,name:'Noleggio'}];
 }});
 assert.equal(result.lead.id,42);assert.deepEqual(result.order_ids,[321]);
});
test('unverified sender, unresolved quotes and conflicting cases require review',async()=>{
 const base={subject:'S00321',text:'',partnerIds:[],call:()=>{throw Error('No lookup for unverified sender');}};
 assert.equal((await matchQuotationThread(base)).reason,'quotation_sender_unverified');
 assert.equal((await matchQuotationThread({...base,partnerIds:[7],call:async()=>[]})).reason,'quotation_reference_unresolved');
 const result=await matchQuotationThread({...base,subject:'S00321 e S00322',partnerIds:[7],call:async()=>[
  {id:321,name:'S00321',opportunity_id:[42,'A']},{id:322,name:'S00322',opportunity_id:[43,'B']}]});
 assert.equal(result.ambiguous,true);assert.deepEqual(result.candidate_ids,[42,43]);
});
