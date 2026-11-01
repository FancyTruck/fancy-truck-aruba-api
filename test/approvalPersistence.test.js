import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { JsonStateStore } = await import(process.env.FANCY_APPROVAL_STORE || '../src/store.js');
const { ApprovalService } = await import(process.env.FANCY_APPROVAL_POLICY || '../src/policy.js');
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'approval-commit-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new JsonStateStore(path.join(dir,'state.json'));
  const approvals=new ApprovalService(store,'synthetic-test-secret');
  const {action}=approvals.queue({type:'SEND_EMAIL',target:'synthetic@example.invalid',
    idempotency_key:'synthetic-approval',payload:{text:'synthetic only'}});
  return {store,approvals,action};
}
function failDisk(store,phase,operation) {
  const original=fs[phase];
  fs[phase]=(...args)=>{if(String(args[0]).startsWith(store.filePath))throw Error('synthetic disk unavailable');return original(...args);};
  try {assert.throws(operation,/synthetic disk unavailable/);}finally{fs[phase]=original;}
}
for(const phase of ['writeFileSync','renameSync']) {
  test(`${phase}: failed command persists neither approval nor audit; held references roll back`,t=>{
    const {store,approvals,action}=fixture(t),before=store.snapshot();
    failDisk(store,phase,()=>approvals.approveCommand(action.id,'Pietro',`APPROVA ${action.id}`));
    assert.deepEqual(store.snapshot(),before);
    assert.equal(action.status,'PENDING_APPROVAL');
    assert.equal(action.confirmation_digest,undefined);
    assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);
    assert.throws(()=>approvals.assertExecutable(action.id));
    assert(approvals.approveCommand(action.id,'Pietro',`APPROVA ${action.id}`).confirmation_token);
  });
  test(`${phase}: failed final confirmation never authorizes execution; same token can be retried`,t=>{
    const {store,approvals,action}=fixture(t);
    const {confirmation_token:token}=approvals.approveCommand(action.id,'Pietro',`APPROVA ${action.id}`);
    const before=store.snapshot();
    failDisk(store,phase,()=>approvals.confirm(action.id,'Pietro',token));
    assert.deepEqual(store.snapshot(),before);
    assert.equal(action.status,'AWAITING_FINAL_CONFIRMATION');
    assert(action.confirmation_digest);
    assert.throws(()=>approvals.assertExecutable(action.id));
    const reopened=new JsonStateStore(store.filePath);
    assert.deepEqual(reopened.snapshot(),before);
    const restarted=new ApprovalService(reopened,'synthetic-test-secret');
    assert.throws(()=>restarted.assertExecutable(action.id));
    restarted.confirm(action.id,'Pietro',token);
    assert.equal(restarted.assertExecutable(action.id).status,'APPROVED_FOR_EXECUTION');
    assert.equal(reopened.state.events.filter(e=>e.type==='ACTION_FINAL_CONFIRMED').length,1);
    const approved=reopened.snapshot();
    assert.equal(restarted.confirm(action.id,'Pietro',token).status,'APPROVED_FOR_EXECUTION');
    assert.deepEqual(reopened.snapshot(),approved);
  });
}
test('command and confirmation each persist state and audit in exactly one commit',t=>{
  const {store,approvals,action}=fixture(t);const save=store.save;let writes=0;
  store.save=function(){writes++;return save.call(this);};
  const command=approvals.approveCommand(action.id,'Pietro',`APPROVA ${action.id}`);
  assert.equal(writes,1);
  const awaiting=new JsonStateStore(store.filePath);
  assert.equal(awaiting.action(action.id).status,'AWAITING_FINAL_CONFIRMATION');
  assert.equal(awaiting.state.events.filter(e=>e.type==='ACTION_COMMAND_APPROVED').length,1);
  approvals.confirm(action.id,'Pietro',command.confirmation_token);assert.equal(writes,2);
  const confirmed=new JsonStateStore(store.filePath);
  assert.equal(confirmed.action(action.id).status,'APPROVED_FOR_EXECUTION');
  assert.equal(confirmed.state.events.filter(e=>e.type==='ACTION_FINAL_CONFIRMED').length,1);
});
test('invalid actor, token and command do not save, authorize or append events',t=>{
  const {store,approvals,action}=fixture(t),before=store.snapshot();let writes=0;
  const save=store.save;store.save=function(){writes++;return save.call(this);};
  assert.throws(()=>approvals.approveCommand(action.id,'Other',`APPROVA ${action.id}`));
  assert.throws(()=>approvals.approveCommand(action.id,'Pietro','generic approval'));
  assert.equal(writes,0);assert.deepEqual(store.snapshot(),before);
  const command=approvals.approveCommand(action.id,'Pietro',`APPROVA ${action.id}`);
  const awaiting=store.snapshot();writes=0;
  assert.throws(()=>approvals.confirm(action.id,'Other',command.confirmation_token));
  assert.throws(()=>approvals.confirm(action.id,'Pietro','wrong-token'));
  assert.equal(writes,0);assert.deepEqual(store.snapshot(),awaiting);
});
