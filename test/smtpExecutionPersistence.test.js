import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {JsonStateStore} from '../src/store.js';
import {ApprovalService} from '../src/policy.js';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smtp-claim-state-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new JsonStateStore(path.join(dir,'state.json')),approvals=new ApprovalService(store,'synthetic-secret');
 const {action}=approvals.queue({type:'SEND_EMAIL',target:'test@example.invalid',idempotency_key:'synthetic',supersede_group:'fixture-group',payload:{subject:'Synthetic',text:'No network'}});
 const {confirmation_token}=approvals.approveCommand(action.id,'Pietro',`APPROVA ${action.id}`);approvals.confirm(action.id,'Pietro',confirmation_token);
 return {store,action,approvals};
}
function failDisk(store,phase,fn){const real=fs[phase];fs[phase]=(...args)=>{if(String(args[0]).startsWith(store.filePath))throw Error('Synthetic disk failure');return real(...args);};try{assert.throws(fn,/Synthetic disk failure/);}finally{fs[phase]=real;}}
for(const phase of ['writeFileSync','renameSync']){
 test(`${phase}: unsuccessful claim rolls back state and audit; no ghost attempt`,t=>{
  const {store,action}=fixture(t),before=store.snapshot();failDisk(store,phase,()=>store.beginSmtpExecution(action.id));
  assert.equal(action.status,'APPROVED_FOR_EXECUTION');assert.equal(action.execution,undefined);assert.deepEqual(store.snapshot(),before);assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);
 });
 test(`${phase}: settlement failure preserves the nonretryable claim in held references and on disk`,t=>{
  const {store,action,approvals}=fixture(t),claim=store.beginSmtpExecution(action.id),before=store.snapshot();
  failDisk(store,phase,()=>store.finishSmtpExecution(action.id,claim.id,'EXECUTED',{status:'accepted_by_smtp',delivery_verified:false}));
  assert.deepEqual(store.snapshot(),before);assert.equal(action.status,'EXECUTING');assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);
  assert.throws(()=>store.beginSmtpExecution(action.id));assert.throws(()=>approvals.assertExecutable(action.id));
 });
}
test('only owner reconciliation quarantines interrupted claims; readers do not change files',t=>{
 const {store,action}=fixture(t),claim=store.beginSmtpExecution(action.id),bytes=fs.readFileSync(store.filePath,'utf8');
 const reader=new JsonStateStore(store.filePath);assert.equal(reader.action(action.id).status,'EXECUTING');assert.equal(fs.readFileSync(store.filePath,'utf8'),bytes);
 assert.equal(reader.reconcileInterruptedSmtpExecutions(),1);assert.equal(reader.action(action.id).status,'UNCERTAIN');assert.equal(reader.action(action.id).execution.message_id,claim.message_id);
 assert.equal(reader.reconcileInterruptedSmtpExecutions(),0);assert.throws(()=>reader.beginSmtpExecution(action.id));
 assert.equal(new JsonStateStore(store.filePath).action(action.id).status,'UNCERTAIN');
});
test('failed owner reconciliation restores held claims and aborts safely',t=>{
 const {store,action}=fixture(t);store.beginSmtpExecution(action.id);const before=store.snapshot();
 failDisk(store,'renameSync',()=>store.reconcileInterruptedSmtpExecutions());assert.equal(action.status,'EXECUTING');assert.deepEqual(store.snapshot(),before);assert.equal(store.reconcileInterruptedSmtpExecutions(),1);
});
test('wrong claim, terminal states, Peu actions and superseding drafts cannot erase or replay an attempt',t=>{
 const {store,action}=fixture(t);const claim=store.beginSmtpExecution(action.id),before=store.snapshot();
 assert.throws(()=>store.finishSmtpExecution(action.id,'another-claim','EXECUTED',{}));assert.deepEqual(store.snapshot(),before);
 assert.equal(store.cancelActionGroup('fixture-group'),false);assert.equal(action.status,'EXECUTING');
 store.finishSmtpExecution(action.id,claim.id,'UNCERTAIN',{status:'outcome_unknown_reconcile_first',delivery_verified:false});assert.equal(store.cancelActionGroup('fixture-group'),false);
 assert.throws(()=>store.beginSmtpExecution(action.id));
 action.status='APPROVED_FOR_EXECUTION';assert.throws(()=>store.beginSmtpExecution(action.id));
 delete action.execution;action.peu_payload_hash='synthetic';assert.throws(()=>store.beginSmtpExecution(action.id));
});

for(const mode of ['owner','read-only','restore-quarantine']) {
 test(`actual server startup: ${mode} never retries a persisted SMTP claim`,t=>{
  const {store,action}=fixture(t);store.beginSmtpExecution(action.id);
  const before=fs.readFileSync(store.filePath,'utf8');
  if(mode==='restore-quarantine')fs.writeFileSync(path.join(path.dirname(store.filePath),'RECOVERY_REQUIRED.json'),'{}');
  const script=`
   import nodemailer from 'nodemailer';
   import {once} from 'node:events';
   globalThis.fetch=()=>{throw Error('No provider calls');};
   nodemailer.createTransport=()=>{throw Error('No SMTP calls');};
   const {server,store}=await import('./src/server.js');
   if(!server.listening)await once(server,'listening');
   console.log('RESULT:'+JSON.stringify(Object.values(store.state.actions).map(a=>a.status)));
   await new Promise(resolve=>server.close(resolve));
  `;
  const stdout=execFileSync(process.execPath,['--input-type=module','-e',script],{
   cwd:new URL('..',import.meta.url),timeout:10000,encoding:'utf8',
   env:{PATH:process.env.PATH,APP_ENV:'test',STATE_FILE:store.filePath,PORT:'0',API_TOKEN:'synthetic',
    READ_ONLY:mode==='read-only'?'true':'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false'},
  });
  const expected=mode==='owner'?'UNCERTAIN':'EXECUTING';
  assert(stdout.includes('RESULT:'+JSON.stringify([expected])));
  assert.equal(new JsonStateStore(store.filePath).action(action.id).status,expected);
  if(mode!=='owner')assert.equal(fs.readFileSync(store.filePath,'utf8'),before);
 });
}
