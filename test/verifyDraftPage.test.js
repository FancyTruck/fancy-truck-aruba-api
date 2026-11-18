import test from 'node:test';import assert from 'node:assert/strict';import {verifyDraftPage} from '../src/verifyDraftPage.js';
test('slow draft checks overlap, stay bounded and preserve results in page order',async()=>{
 const drafts=Array.from({length:10},(_,i)=>({action_id:String(i)})),actions=Object.fromEntries(drafts.map(d=>[d.action_id,{id:d.action_id,status:'PENDING_APPROVAL',supersede_group:'missing-details:lead'}]));
 let active=0,peak=0;
 const page=await verifyDraftPage(drafts,actions,async a=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;if(a.id==='3')throw Error('mailbox unavailable');return a.id!=='5';});
 assert.equal(peak,4);assert.equal(page.verification_pending,2);assert.deepEqual(page.drafts.map(d=>d.action_id),['0','1','2','4','6','7','8','9']);
});
test('manual drafts bypass automatic checks; cancelled or missing rows stay hidden',async()=>{
 const drafts=['manual','cancelled','gone'].map(action_id=>({action_id}));const result=await verifyDraftPage(drafts,{manual:{status:'PENDING_APPROVAL'},cancelled:{status:'CANCELLED'}},()=>{throw Error('should not run');});assert.deepEqual(result.drafts,[drafts[0]]);assert.equal(result.verification_pending,0);
});

test('verification failure exposes a stable safe reason',async()=>{
 const drafts=[{action_id:'draft'}],actions={draft:{status:'PENDING_APPROVAL',supersede_group:'missing-details:lead'}};
 const out=await verifyDraftPage(drafts,actions,async()=>{const e=Error('private provider details');e.code='draft_original_not_found';throw e;});
 assert.equal(out.suspended_drafts[0].verification_reason,'draft_original_not_found');assert.equal(out.verification_pending,1);
});
