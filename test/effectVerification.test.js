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
function fixture(t,kind,observation){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'effect-verification-')),db=new DatabaseSync(':memory:');
 t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
 const store=new JsonStateStore(path.join(directory,'state.json')),approvals=new ApprovalService(store,'synthetic');let effects=0;
 const payload=kind==='mail.send'?{account:'pietro',to:'fixture@example.invalid',subject:'Synthetic',text:'Fixture'}:{capability:'quote.prepare',parameters:{partner_id:1,lines:[],order_type:'sale'}};
 const {action}=approvals.queue({type:kind==='mail.send'?'SEND_EMAIL':'IRREVERSIBLE_ACTION',target:kind,payload,peu_payload_hash:hash(payload),idempotency_key:'fixture'});
 const approval=approvals.approveCommand(action.id,'Pietro',`APPROVA ${action.id}`);approvals.confirm(action.id,'Pietro',approval.confirmation_token);
 const config={db,approvals,assertWritable(){},smtp:async()=>{effects++;return observation;},upstream:async()=>{effects++;return {ok:true,id:42};},verify:async()=>observation};
 let contract=makePeuContract(config);
 const command=key=>{const c=contract.catalog().capabilities.find(x=>x.id===kind),parameters={action_id:action.id,payload_hash:action.peu_payload_hash};return {capability:kind,parameters,idempotency_key:key,operation_id:key,confirmation:{confirmed:true,payload_hash:hash({provider:'fancy',capability:kind,domain:'work',payload:{parameters,catalog_hash:hash(c)},effect:c.effect,confirmation:c.confirmation})}};};
 return {store,action,db,async execute(key){return contract.execute(command(key));},reopen(){config.approvals=new ApprovalService(new JsonStateStore(store.filePath),'synthetic');contract=makePeuContract(config);},get effects(){return effects;}};
}
for(const [label,result] of [['negative',{ok:false,status:'unverified'}],['missing',undefined]])test(`Peu rejects ${label} management verification and keeps uncertain barrier`,async t=>{
 const f=fixture(t,'operation.execute',result),before=fs.readFileSync(f.store.filePath,'utf8');
 await assert.rejects(f.execute('first'),e=>e.code==='outcome_unknown_reconcile_first');
 assert.equal(f.action.status,'APPROVED_FOR_EXECUTION');assert.equal(fs.readFileSync(f.store.filePath,'utf8'),before);
 assert.equal(f.db.prepare('SELECT status FROM peu_effects').get().status,'unknown');
 f.reopen();await assert.rejects(f.execute('second'),e=>e.code==='outcome_unknown_reconcile_first');assert.equal(f.effects,1);
});
test('Peu pending SMTP recipients cannot produce successful receipt or retry',async t=>{
 const f=fixture(t,'mail.send',{accepted:['fixture@example.invalid'],rejected:[],pending:['pending@example.invalid'],messageId:'synthetic'});
 await assert.rejects(f.execute('first'),e=>e.code==='outcome_unknown_reconcile_first');assert.equal(f.action.status,'APPROVED_FOR_EXECUTION');
 f.reopen();await assert.rejects(f.execute('second'),e=>e.code==='outcome_unknown_reconcile_first');assert.equal(f.effects,1);
});
test('Peu positive management verification records receipt once and replays after reopen',async t=>{
 const f=fixture(t,'operation.execute',{ok:true,status:'verified',id:42});const result=await f.execute('first');assert.equal(result.result.status,'verified');assert.equal(f.action.status,'EXECUTED');
 f.reopen();assert.deepEqual((await f.execute('second')).result,result.result);assert.equal(f.effects,1);
});
