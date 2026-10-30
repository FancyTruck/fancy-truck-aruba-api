import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureCustomerAttention} from '../src/customerAttention.js';
import {classifyCommercialMessage} from '../src/commercialFilter.js';
test('incomplete customer request creates exactly one internal owner activity on replay',async()=>{
 let exists=false;const writes=[];
 const call=async(model,method,args,options)=>{
  if(method==='search_count')return Number(exists);
  if(method==='search_read')return [{id:1}];
  assert.equal(model,'mail.activity');assert.equal(method,'create');assert.equal(options.context.mail_activity_quick_update,true);
  writes.push(args[0][0]);exists=true;return [7];
 };
 await ensureCustomerAttention({call,leadId:506,ownerId:2});await ensureCustomerAttention({call,leadId:506,ownerId:2});
 assert.equal(writes.length,1);assert.equal(writes[0].res_id,506);assert.equal(writes[0].user_id,2);assert.equal(writes[0].partner_ids,undefined);
});
test('creative activation brief is commercial without a named truck model',()=>{
 const r=classifyCommercialMessage('Progetto sport Milano',"Ho un progetto, mi affiderei a voi. Brand awareness. Da sviluppare: concept dell’evento, branding, costi. Budget 25-30k. Due giornate con un mezzo che voi saprete suggerire.");
 assert.equal(r.kind,'brand_activation');
 assert.equal(classifyCommercialMessage('Servizi marketing','Offriamo branding per eventi, concept e budget su misura').kind,null);
});
