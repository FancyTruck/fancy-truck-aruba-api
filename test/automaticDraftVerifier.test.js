import test from 'node:test';import assert from 'node:assert/strict';import {automaticDraftVerifier} from '../src/automaticDraftVerifier.js';
function fixture(){const action={id:'a',status:'PENDING_APPROVAL',target:'client@example.invalid',payload:{account:'hello',inReplyTo:'<exact>'}},original={source:'odoo_received',odoo_message_id:10,case_id:222,payload:{text:'Need a rental',from:[{address:'client@example.invalid'}]}};let rows=[],decision={kind:'rental'},saves=0,team=false;
const store={save(){saves++;},audit(){}};const verify=automaticDraftVerifier({readOriginal:async()=>({original}),odooRead:async()=>rows,classify:()=>decision,teamCheck:async()=>({handled:team}),store,log(){}});
return {action,original,store,verify,get saves(){return saves;},rows:v=>rows=v,decision:v=>decision=v,team:()=>team=true};}
test('a later customer reply retires the obsolete auto question without sending',async()=>{const f=fixture();f.rows([{id:11,email_from:'Client <client@example.invalid>'}]);assert.equal(await f.verify(f.action),false);assert.equal(f.action.cancel_reason,'CUSTOMER_REPLIED_AFTER_SOURCE');assert.equal(f.saves,1);});
test('an exact Odoo team reply retires the old question; internal notes do not establish ancestry',async()=>{const f=fixture();f.rows([{email_from:'matteo@fancytruck.it',parent_id:[10,'Original']}]);assert.equal(await f.verify(f.action),false);assert.equal(f.action.cancel_reason,'TEAM_ALREADY_REPLIED');const g=fixture();g.rows([{email_from:'matteo@fancytruck.it',parent_id:[99,'Other']}]);assert.equal(await g.verify(g.action),true);});
test('supplier and administrative originals never authorize an automatic customer question',async()=>{const f=fixture();f.decision({reason:'administrative_or_marketing'});assert.equal(await f.verify(f.action),false);assert.equal(f.action.cancel_reason,'NOT_CUSTOMER_REQUEST');});
test('valid recovered source with no later replies stays pending for owner confirmation',async()=>{const f=fixture();assert.equal(await f.verify(f.action),true);assert.equal(f.action.status,'PENDING_APPROVAL');assert.equal(f.saves,0);});
test('failed persistence restores the pending action and cannot pretend retirement succeeded',async()=>{const f=fixture();f.team();f.store.save=()=>{throw Error('disk');};await assert.rejects(f.verify(f.action));assert.equal(f.action.status,'PENDING_APPROVAL');assert.equal(f.action.cancel_reason,undefined);});
test('partial originals never authorize sending',async()=>{const f=fixture();f.original.payload.text_truncated=true;await assert.rejects(f.verify(f.action),{code:'draft_original_incomplete'});assert.equal(f.action.status,'PENDING_APPROVAL');});

test('unclear commercial intent cannot authorize an automatic request for quote details',async()=>{const f=fixture();f.decision({kind:null,reason:'commercial_intent_not_established'});assert.equal(await f.verify(f.action),false);assert.equal(f.action.cancel_reason,'NOT_CUSTOMER_REQUEST');});
test('read-only or recovery mode cannot retire a stored draft',async()=>{
 const action={id:'a',status:'PENDING_APPROVAL',payload:{account:'hello',inReplyTo:'<id>'}};
 const verify=automaticDraftVerifier({readOriginal:async()=>({original:{payload:{text:'Administrative'}}}),classify:()=>({kind:null}),store:{save:()=>assert.fail('No write'),audit(){}},canRetire:()=>false,log(){}});
 await assert.rejects(verify(action),{code:'draft_recovery_writes_blocked'});assert.equal(action.status,'PENDING_APPROVAL');
});

test('an exact original in another inbox cannot authorize a different recipient',async()=>{const f=fixture();f.action.target='other@example.invalid';await assert.rejects(f.verify(f.action),{code:'draft_source_recipient_mismatch'});assert.equal(f.action.status,'PENDING_APPROVAL');});
