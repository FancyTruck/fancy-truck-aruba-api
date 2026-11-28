import test from 'node:test';import assert from 'node:assert/strict';
import {replyCycleEvidence} from '../src/replyCycleEvidence.js';
const base={account:'hello',messageId:'<request>',sender:'client@example.invalid',readOriginal:async()=>({original:{message_id:'<request>',payload:{text:'Request',from:[{address:'client@example.invalid'}]}}}),teamCheck:async()=>({handled:false})};
const action={type:'SEND_EMAIL',status:'EXECUTED',payload:{account:'hello',inReplyTo:'<request>',to:'client@example.invalid',text:'Answer'},executed_at:'2026-11-22T08:00:00Z',result:{accepted:['client@example.invalid'],rejected:[],message_id:'<sent>'}};
const clone=()=>structuredClone(action),err={code:'reply_evidence_incomplete',status:503};
test('ledger cap rejects incomplete scan even after finding a valid receipt',async()=>{
 const actions={first:clone()};for(let i=0;i<10000;i++)actions['a'+i]={status:'PENDING_APPROVAL'};
 let called=false;await assert.rejects(replyCycleEvidence({...base,actions,teamCheck:async()=>{called=true;return {handled:false};}}),err);assert.equal(called,false);assert.equal(actions.first.status,'EXECUTED');
});
test('exact10000actions preserve latest chronological receipt without copying or mutating rows',async()=>{
 const actions={};for(let i=0;i<9998;i++)actions[i]={status:'PENDING_APPROVAL'};
 actions.a=clone();actions.a.executed_at='2026-11-22T09:00:00+02:00';actions.b=clone();actions.b.result.message_id='<latest>';
 const before=JSON.stringify(actions);const r=await replyCycleEvidence({...base,actions});assert.equal(r.outgoing.message_id,'<latest>');assert.equal(JSON.stringify(actions),before);
});
test('oversized local text fails closed rather than falling back to older receipt',async()=>{
 const old=clone(),latest=clone();latest.executed_at='2026-11-22T09:00:00Z';latest.payload.text='x'.repeat(256*1024+1);
 await assert.rejects(replyCycleEvidence({...base,actions:{old,latest}}),err);
});
test('local text byte boundary retained exactly; UTF8 excess rejected',async()=>{
 const a=clone();a.payload.text='€'.repeat(87381)+'x';assert.equal((await replyCycleEvidence({...base,actions:{a}})).outgoing.text,a.payload.text);
 a.payload.text+='€';await assert.rejects(replyCycleEvidence({...base,actions:{a}}),err);
});
test('only selected remote proof fields are projected; unrelated large/cyclic fields never serialized',async()=>{
 const evidence={message_id:'<remote>',at:'2026-11-22T09:00:00Z',text:'Answer',providerBlob:'x'.repeat(1024*1024)};evidence.loop=evidence;
 const result=await replyCycleEvidence({...base,teamCheck:async()=>({handled:true,evidence})});assert.deepEqual(Object.keys(result.outgoing).sort(),['at','message_id','receipt','text']);assert(JSON.stringify(result).length<1000);assert.equal(evidence.loop,evidence);
});
test('oversized or unsupported remote proof blocks even when local receipt is valid',async()=>{
 for(const patch of [{text:'€'.repeat(90000)},{message_id:'x'.repeat(999)},{text:{toString:()=> 'Answer'}}])await assert.rejects(replyCycleEvidence({...base,actions:{a:clone()},teamCheck:async()=>({handled:true,evidence:{message_id:'<remote>',at:'2026-11-22T09:00:00Z',text:'Answer',...patch}})}),err);
});
test('unavailable team check cannot be silently treated as no remote answer',async()=>{
 for(const result of [undefined,{}, {handled:'false'}])await assert.rejects(replyCycleEvidence({...base,actions:{a:clone()},teamCheck:async()=>result}),err);
});
test('oversized original source is rejected, moderate display truncation remains explicit',async()=>{
 const original=text=>async()=>({original:{message_id:'<request>',payload:{text,from:[{address:base.sender}]}}});
 await assert.rejects(replyCycleEvidence({...base,readOriginal:original('€'.repeat(800000))}),err);
 const r=await replyCycleEvidence({...base,readOriginal:original('x'.repeat(18001))});assert.equal(r.original.text.length,18000);assert.equal(r.original.text_truncated,true);
});
test('oversized accepted list and malformed ledger cannot count as exact send evidence',async()=>{
 const a=clone();a.result.accepted=Array(101).fill(base.sender);await assert.rejects(replyCycleEvidence({...base,actions:{a}}),err);
 await assert.rejects(replyCycleEvidence({...base,actions:[]}),err);
});
test('all send types retain exact receipt behavior, unknown/pending/rejected do not count',async()=>{
 for(const type of ['SEND_EMAIL','SEND_FOLLOW_UP','SEND_PAYMENT_REMINDER','SEND_QUOTE','SEND_CONTRACT','SEND_INVOICE'])assert.equal((await replyCycleEvidence({...base,actions:{a:{...clone(),type}}})).handled,true);
 for(const status of ['OUTCOME_UNKNOWN','PENDING_APPROVAL'])assert.equal((await replyCycleEvidence({...base,actions:{a:{...clone(),status}}})).handled,false);
 const a=clone();a.result.rejected=[base.sender];assert.equal((await replyCycleEvidence({...base,actions:{a}})).handled,false);
});
