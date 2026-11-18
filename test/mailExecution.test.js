import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {JsonStateStore} from '../src/store.js';
import {ApprovalService} from '../src/policy.js';
import {executeMailAction} from '../src/mailExecution.js';
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mail-execution-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const store=new JsonStateStore(path.join(directory,'state.json')),approvals=new ApprovalService(store,'synthetic');
 const {action}=approvals.queue({type:'SEND_EMAIL',target:'test@example.invalid',idempotency_key:'test',payload:{subject:'Synthetic',text:'Synthetic',account:'hello'}});
 const approval=approvals.approveCommand(action.id,'Pietro','APPROVA '+action.id);approvals.confirm(action.id,'Pietro',approval.confirmation_token);
 return {store,approvals,id:action.id};
}
test('concurrent execution reserves persisted action before SMTP; sends once',async t=>{
 const f=fixture(t);let release,calls=0;const gate=new Promise(r=>release=r);
 const send=async payload=>{calls++;assert.equal(new JsonStateStore(f.store.filePath).action(f.id).status,'EXECUTING');assert.equal(payload.to,'test@example.invalid');assert.equal(payload.messageId,`<fancy-${f.id}@fancytruck.it>`);await gate;return {messageId:payload.messageId,accepted:[payload.to],rejected:[]};};
 const first=executeMailAction({...f,send});await assert.rejects(executeMailAction({...f,send}));release();const result=await first;
 assert.equal(result.status,'EXECUTED');assert.equal(calls,1);await assert.rejects(executeMailAction({...f,send}));assert.equal(calls,1);
});
test('lost SMTP response remains blocked after restart',async t=>{
 const f=fixture(t);let calls=0;const send=async()=>{calls++;throw Error('lost response');};
 await assert.rejects(executeMailAction({...f,send}),/lost response/);
 const restarted=new ApprovalService(new JsonStateStore(f.store.filePath),'synthetic');
 assert.equal(restarted.store.action(f.id).status,'OUTCOME_UNKNOWN');await assert.rejects(executeMailAction({approvals:restarted,id:f.id,send}));assert.equal(calls,1);
});
test('interrupted execution is not retried after process restart',async t=>{
 const f=fixture(t);f.store.updateAction(f.id,{status:'EXECUTING'});let calls=0;
 const restarted=new ApprovalService(new JsonStateStore(f.store.filePath),'synthetic');await assert.rejects(executeMailAction({approvals:restarted,id:f.id,send:async()=>{calls++;}}));assert.equal(calls,0);
});
test('failure to persist reservation prevents SMTP and preserves approval',async t=>{
 const f=fixture(t);f.store.save=()=>{throw Error('disk full');};let calls=0;
 await assert.rejects(executeMailAction({...f,send:async()=>{calls++;}}),/disk full/);assert.equal(calls,0);assert.equal(f.store.action(f.id).status,'APPROVED_FOR_EXECUTION');
});
test('partial recipient acceptance is uncertain and cannot be repeated',async t=>{
 const f=fixture(t);await assert.rejects(executeMailAction({...f,send:async()=>({accepted:['one@example.invalid'],rejected:['two@example.invalid']})}));assert.equal(f.store.action(f.id).status,'OUTCOME_UNKNOWN');
});
