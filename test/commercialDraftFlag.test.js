import test from 'node:test';import assert from 'node:assert/strict';import {verifyDraftPage} from '../src/verifyDraftPage.js';
test('commercial reply marker requires a verified automatic customer reply and an original',async()=>{
 const drafts=['customer','manual','missing-source','supplier','uncertain','closed'].map(action_id=>({action_id,in_reply_to:action_id==='missing-source'?null:'<'+action_id+'>'}));
 const actions=Object.fromEntries(drafts.map(d=>[d.action_id,{id:d.action_id,status:d.action_id==='closed'?'CANCELLED':'PENDING_APPROVAL',supersede_group:d.action_id==='manual'?undefined:'missing-details:1'}]));let checked=[];
 const r=await verifyDraftPage(drafts,actions,async a=>{checked.push(a.id);if(a.id==='uncertain')throw Error('unavailable');if(a.id==='supplier'){a.status='CANCELLED';return false;}return true;});
 assert.deepEqual(r.drafts.map(d=>[d.action_id,d.commercial_reply]),[['customer',true],['manual',false],['missing-source',false]]);assert.equal(checked.includes('manual'),false);assert.equal(r.verification_pending,1);assert.equal(r.suspended_drafts[0].action_id,'uncertain');
});
