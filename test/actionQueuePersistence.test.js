import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {JsonStateStore} from '../src/store.js';
import {ApprovalService} from '../src/policy.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'queue-atomic-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new JsonStateStore(path.join(dir,'state.json'));return {store,approvals:new ApprovalService(store,'synthetic')};}
const input=key=>({type:'SEND_EMAIL',target:'synthetic@example.invalid',idempotency_key:key,supersede_group:'same-case',payload:{subject:'Synthetic',text:'No external transport'}});
function diskFailure(store,phase,fn){const real=fs[phase];fs[phase]=(...args)=>{if(String(args[0]).startsWith(store.filePath))throw Error('Synthetic disk failure');return real(...args);};try{assert.throws(fn,/Synthetic disk failure/);}finally{fs[phase]=real;}}
for(const phase of ['writeFileSync','renameSync']){
 test(`${phase}: failed queue has no ghost action or audit and retry is not a false duplicate`,t=>{
  const {store,approvals}=fixture(t);store.save();const before=store.snapshot();diskFailure(store,phase,()=>approvals.queue(input('new')));assert.deepEqual(store.snapshot(),before);assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);assert.equal(approvals.queue(input('new')).duplicate,false);
 });
 test(`${phase}: failed supersession restores all old held actions and never partially cancels them`,t=>{
  const {store,approvals}=fixture(t),a=approvals.queue(input('old')).action;
  // A historical group can contain more than one outstanding action.
  const b=approvals.queue({...input('other'),supersede_group:'other-group'}).action;b.supersede_group='same-case';store.save();
  const before=store.snapshot();diskFailure(store,phase,()=>approvals.queue(input('replacement')));
  assert.equal(a.status,'PENDING_APPROVAL');assert.equal(b.status,'PENDING_APPROVAL');assert.equal(a.cancelled_at,undefined);assert.deepEqual(store.snapshot(),before);assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);
 });
 test(`${phase}: failed direct group cancellation preserves held references and audit`,t=>{
  const {store,approvals}=fixture(t),a=approvals.queue(input('cancel')).action,before=store.snapshot();diskFailure(store,phase,()=>store.cancelActionGroup('same-case','REQUEST_COMPLETED'));assert.equal(a.status,'PENDING_APPROVAL');assert.deepEqual(store.snapshot(),before);assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);
 });
}
test('supersession commits both cancellations and replacement audit exactly once; replay is read-only',t=>{
 const {store,approvals}=fixture(t),old=approvals.queue(input('old')).action;const save=store.save;let saves=0;store.save=function(){saves++;return save.call(this);};
 const next=approvals.queue(input('next'));assert.equal(saves,1);assert.equal(old.status,'CANCELLED');assert.equal(next.action.status,'PENDING_APPROVAL');assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),store.snapshot());
 const before=store.snapshot();assert.equal(approvals.queue(input('next')).duplicate,true);assert.equal(saves,1);assert.deepEqual(store.snapshot(),before);
 assert.equal(store.state.events.filter(e=>e.type==='ACTION_CANCELLED'&&e.action_id===old.id).length,1);
});
test('supersession preserves claimed uncertain SMTP attempt and terminal history',t=>{
 const {store,approvals}=fixture(t),old=approvals.queue(input('claimed')).action;const {confirmation_token}=approvals.approveCommand(old.id,'Pietro',`APPROVA ${old.id}`);approvals.confirm(old.id,'Pietro',confirmation_token);const claim=store.beginSmtpExecution(old.id);store.finishSmtpExecution(old.id,claim.id,'UNCERTAIN',{delivery_verified:false});const snapshot=structuredClone(old);
 const next=approvals.queue(input('different-action'));assert.equal(next.action.status,'PENDING_APPROVAL');assert.deepEqual(old,snapshot);assert.equal(store.cancelActionGroup('nonexistent'),false);assert.throws(()=>approvals.assertExecutable(old.id));
});
test('replacement write failure cannot durably cancel the old draft before the replacement exists',t=>{
 const {store,approvals}=fixture(t),old=approvals.queue(input('original')).action,before=store.snapshot();const write=fs.writeFileSync;
 fs.writeFileSync=(...args)=>{if(String(args[0]).startsWith(store.filePath)&&String(args[1]).includes('replacement-fail'))throw Error('Replacement write failed');return write(...args);};
 try{assert.throws(()=>approvals.queue(input('replacement-fail')),/Replacement write failed/);}finally{fs.writeFileSync=write;}
 assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);assert.deepEqual(store.snapshot(),before);assert.equal(old.status,'PENDING_APPROVAL');
});
