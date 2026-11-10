import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {JsonStateStore} from '../src/store.js';
import {ApprovalService} from '../src/policy.js';
import {makePeuContract} from '../src/peuContract.js';
import {hash} from '../src/peuCommon.js';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'execution-receipt-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new JsonStateStore(path.join(dir,'state.json')),approvals=new ApprovalService(store,'synthetic');
 const payload={account:'pietro',to:'fixture@example.invalid',subject:'Synthetic',text:'Fixture'};
 const {action}=approvals.queue({type:'SEND_EMAIL',target:payload.to,payload,peu_payload_hash:hash(payload),idempotency_key:'fixture'});
 const c=approvals.approveCommand(action.id,'Pietro',`APPROVA ${action.id}`);approvals.confirm(action.id,'Pietro',c.confirmation_token);
 return {store,approvals,action};
}
for(const method of ['writeFileSync','renameSync'])test(`execution receipt rolls back held action and audit on ${method} failure`,t=>{
 const {store,approvals,action}=fixture(t),before=store.snapshot(),bytes=fs.readFileSync(store.filePath,'utf8'),events=store.state.events;
 const original=fs[method];fs[method]=()=>{throw Error('synthetic disk failure');};
 try{assert.throws(()=>approvals.executed(action.id,{ok:true}),/disk failure/);}finally{fs[method]=original;}
 assert.equal(store.action(action.id),action);assert.equal(store.state.events,events);assert.deepEqual(store.snapshot(),before);
 assert.equal(fs.readFileSync(store.filePath,'utf8'),bytes);assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);
});
test('successful execution receipt and audit persist in one save',t=>{
 const {store,approvals,action}=fixture(t);let saves=0;const save=store.save.bind(store);store.save=()=>{saves++;save();};
 assert.equal(approvals.executed(action.id,{ok:true}).status,'EXECUTED');assert.equal(saves,1);
 const reopened=new JsonStateStore(store.filePath),event=reopened.state.events.at(-1);
 assert.equal(reopened.action(action.id).status,'EXECUTED');assert.equal(event.type,'ACTION_EXECUTED');assert.equal(event.action_id,action.id);
});
test('Peu post-effect receipt failure remains uncertain across keys and restart without another send',async t=>{
 const {store,approvals,action}=fixture(t),db=new DatabaseSync(':memory:');t.after(()=>db.close());let sends=0;
 const config={db,approvals,assertWritable(){},smtp:async()=>{sends++;store.save=()=>{throw Error('synthetic receipt persistence failure');};return {accepted:['fixture@example.invalid'],rejected:[],messageId:'synthetic'};}};
 let contract=makePeuContract(config);
 const command=key=>{const capability=contract.catalog().capabilities.find(x=>x.id==='mail.send'),parameters={action_id:action.id,payload_hash:action.peu_payload_hash};return {operation_id:key,idempotency_key:key,capability:capability.id,parameters,confirmation:{confirmed:true,payload_hash:hash({provider:'fancy',capability:capability.id,domain:'work',payload:{parameters,catalog_hash:hash(capability)},effect:capability.effect,confirmation:capability.confirmation})}};};
 await assert.rejects(contract.execute(command('first')),e=>e.code==='outcome_unknown_reconcile_first');
 assert.equal(db.prepare('SELECT status FROM peu_effects').get().status,'unknown');
 assert.equal(action.status,'APPROVED_FOR_EXECUTION');assert.equal(new JsonStateStore(store.filePath).action(action.id).status,'APPROVED_FOR_EXECUTION');
 contract=makePeuContract(config);await assert.rejects(contract.execute(command('second')),e=>e.code==='outcome_unknown_reconcile_first');assert.equal(sends,1);
});
