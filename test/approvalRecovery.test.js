import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {JsonStateStore}=await import(process.env.FANCY_RECOVERY_STORE||'../src/store.js');
const {ApprovalService}=await import(process.env.FANCY_RECOVERY_POLICY||'../src/policy.js');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'approval-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new JsonStateStore(path.join(dir,'state.json'));const service=new ApprovalService(store,'synthetic-secret');
 const {action}=service.queue({type:'SEND_EMAIL',target:'synthetic@example.invalid',idempotency_key:'synthetic-recovery'});
 return{store,service,action,reopen:()=>new ApprovalService(new JsonStateStore(store.filePath),'synthetic-secret')};}
const command=(s,id)=>s.approveCommand(id,'Pietro',`APPROVA ${id}`);
test('lost command response can recover after reopen by reissuing only the pending token',t=>{
 const f=fixture(t),old=command(f.service,f.action.id);const reopened=f.reopen(),fresh=command(reopened,f.action.id);
 assert.notEqual(fresh.confirmation_token,old.confirmation_token);assert.throws(()=>reopened.assertExecutable(f.action.id));
 assert.throws(()=>reopened.confirm(f.action.id,'Pietro',old.confirmation_token));
 reopened.confirm(f.action.id,'Pietro',fresh.confirmation_token);
 assert.equal(reopened.assertExecutable(f.action.id).status,'APPROVED_FOR_EXECUTION');
 assert.equal(reopened.store.state.events.filter(e=>e.type==='ACTION_COMMAND_REISSUED').length,1);
 assert(!fs.readFileSync(f.store.filePath,'utf8').includes(fresh.confirmation_token));
});
test('lost final response replay after reopen is strictly readonly with the exact consumed token',t=>{
 const f=fixture(t),a=command(f.service,f.action.id);f.service.confirm(f.action.id,'Pietro',a.confirmation_token);
 const reopened=f.reopen(),before=reopened.store.snapshot(),bytes=fs.readFileSync(f.store.filePath,'utf8');
 reopened.store.save=()=>assert.fail('replay must not save');
 assert.equal(reopened.confirm(f.action.id,'Pietro',a.confirmation_token).status,'APPROVED_FOR_EXECUTION');
 assert.deepEqual(reopened.store.snapshot(),before);assert.equal(fs.readFileSync(f.store.filePath,'utf8'),bytes);
 assert.equal(before.events.filter(e=>e.type==='ACTION_FINAL_CONFIRMED').length,1);
});
for(const phase of ['writeFileSync','renameSync'])test(`${phase}: unsuccessful token reissue preserves old token and audit`,t=>{
 const f=fixture(t),a=command(f.service,f.action.id),before=f.store.snapshot(),original=fs[phase];
 fs[phase]=(...args)=>{if(String(args[0]).startsWith(f.store.filePath))throw Error('synthetic storage failure');return original(...args);};
 try{assert.throws(()=>command(f.service,f.action.id),/synthetic storage failure/);}finally{fs[phase]=original;}
 assert.deepEqual(f.store.snapshot(),before);assert.deepEqual(new JsonStateStore(f.store.filePath).snapshot(),before);
 f.service.confirm(f.action.id,'Pietro',a.confirmation_token);
});
test('recovery requires the original actor, exact command and token for this action',t=>{
 const f=fixture(t),a=command(f.service,f.action.id);const before=f.store.snapshot();
 assert.throws(()=>f.service.approveCommand(f.action.id,'Other',`APPROVA ${f.action.id}`));
 assert.throws(()=>f.service.approveCommand(f.action.id,'Pietro','APPROVA everything'));
 assert.deepEqual(f.store.snapshot(),before);
 f.service.confirm(f.action.id,'Pietro',a.confirmation_token);const approved=f.store.snapshot();
 for(const token of ['wrong',a.confirmation_token+'.extra'])assert.throws(()=>f.service.confirm(f.action.id,'Pietro',token));
 assert.throws(()=>f.service.confirm(f.action.id,'Other',a.confirmation_token));
 assert.throws(()=>command(f.service,f.action.id));assert.deepEqual(f.store.snapshot(),approved);
});
test('cancelled, uncertain, executed and legacy approved actions never receive recovery authorization',t=>{
 for(const status of ['CANCELLED','EXECUTED','UNCERTAIN','APPROVED_FOR_EXECUTION']){
  const f=fixture(t),a=command(f.service,f.action.id);f.store.updateAction(f.action.id,{status,confirmation_digest:null});
  const before=f.store.snapshot();assert.throws(()=>command(f.service,f.action.id));
  assert.throws(()=>f.service.confirm(f.action.id,'Pietro',a.confirmation_token));assert.deepEqual(f.store.snapshot(),before);
 }
});
test('rotated and cross-action tokens cannot retrieve an already approved result',t=>{
 const f=fixture(t),old=command(f.service,f.action.id),fresh=command(f.service,f.action.id);
 f.service.confirm(f.action.id,'Pietro',fresh.confirmation_token);
 assert.throws(()=>f.service.confirm(f.action.id,'Pietro',old.confirmation_token));
 const {action:other}=f.service.queue({type:'SEND_EMAIL',target:'other@example.invalid',idempotency_key:'other-action'});
 command(f.service,other.id);assert.throws(()=>f.service.confirm(other.id,'Pietro',fresh.confirmation_token));
});
