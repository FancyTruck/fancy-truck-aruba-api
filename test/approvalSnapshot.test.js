import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import nodemailer from 'nodemailer';
import {JsonStateStore} from '../src/store.js';
import {ApprovalService} from '../src/policy.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'approval-snapshot-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new JsonStateStore(path.join(dir,'state.json'));const service=new ApprovalService(store,'synthetic-secret');const {action}=service.queue({type:'SEND_EMAIL',target:'synthetic@example.invalid',payload:{subject:'Synthetic',text:'Original'},idempotency_key:'synthetic-snapshot'});return {store,service,action};}
const command=(s,id)=>s.approveCommand(id,'Pietro',`APPROVA ${id}`);
for(const phase of ['reissue','confirm','execute'])for(const field of ['type','target','payload'])test(`${phase} rejects changed ${field} without writing or reauthorizing`,t=>{
 const {store,service,action}=fixture(t);const c=command(service,action.id);
 if(phase==='execute')service.confirm(action.id,'Pietro',c.confirmation_token);
 store.updateAction(action.id,{[field]:field==='payload'?{...action.payload,text:'Changed'}:field==='type'?'MAKE_REFUND':'different@example.invalid'});
 const before=store.snapshot(),bytes=fs.readFileSync(store.filePath,'utf8');store.save=()=>assert.fail('unexpected persistence');
 assert.throws(()=>phase==='reissue'?command(service,action.id):phase==='confirm'?service.confirm(action.id,'Pietro',c.confirmation_token):service.assertExecutable(action.id),/snapshot/i);
 if(phase==='execute')assert.throws(()=>service.confirm(action.id,'Pietro',c.confirmation_token),/snapshot/i);
 assert.deepEqual(store.snapshot(),before);assert.equal(fs.readFileSync(store.filePath,'utf8'),bytes);
});
test('unchanged snapshot survives reopening, object-key reorder and exact-token readonly replay',t=>{
 const {store,service,action}=fixture(t),c=command(service,action.id);
 assert.match(action.approval_snapshot_hash,/^[a-f0-9]{64}$/);
 const reopened=new JsonStateStore(store.filePath),s=new ApprovalService(reopened,'synthetic-secret');
 reopened.action(action.id).payload={text:'Original',subject:'Synthetic'};
 s.confirm(action.id,'Pietro',c.confirmation_token);reopened.save=()=>assert.fail('readonly replay');
 assert.equal(s.confirm(action.id,'Pietro',c.confirmation_token).status,'APPROVED_FOR_EXECUTION');assert.equal(s.assertExecutable(action.id).id,action.id);
});
test('legacy awaiting/approved records without a snapshot fail closed without backfilling authorization',t=>{
 const {store,service,action}=fixture(t),c=command(service,action.id);delete action.approval_snapshot_hash;
 assert.throws(()=>command(service,action.id),/snapshot/i);assert.throws(()=>service.confirm(action.id,'Pietro',c.confirmation_token),/snapshot/i);
 action.status='APPROVED_FOR_EXECUTION';assert.throws(()=>service.assertExecutable(action.id),/snapshot/i);assert.equal(action.approval_snapshot_hash,undefined);
});
test('failed command persistence rolls back snapshot with authorization and audit',t=>{
 const {store,service,action}=fixture(t);const before=store.snapshot();store.save=()=>{throw Error('Synthetic disk failure');};
 assert.throws(()=>command(service,action.id),/disk failure/);assert.equal(action.approval_snapshot_hash,undefined);assert.deepEqual(store.snapshot(),before);
});
test('real HTTP execution rejects changed approved payload before transport construction or claim',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snapshot-http-'));Object.assign(process.env,{APP_ENV:'test',PORT:'0',STATE_FILE:path.join(dir,'state.json'),API_TOKEN:'synthetic-snapshot-token',READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',HELLO_EMAIL:'sender@example.invalid',HELLO_PASSWORD:'synthetic-only'});
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');const realFetch=globalThis.fetch,transport=nodemailer.createTransport;let outbound=0,constructed=0;
 globalThis.fetch=async()=>{outbound++;throw Error('No provider');};nodemailer.createTransport=()=>{constructed++;throw Error('No SMTP construction allowed');};
 t.after(async()=>{globalThis.fetch=realFetch;nodemailer.createTransport=transport;await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const {action}=app.approvals.queue({type:'SEND_EMAIL',target:'synthetic@example.invalid',payload:{subject:'Synthetic',text:'Original'},idempotency_key:'snapshot-http'});const c=command(app.approvals,action.id);app.approvals.confirm(action.id,'Pietro',c.confirmation_token);
 app.store.updateAction(action.id,{payload:{...action.payload,text:'Changed'}});const bytes=fs.readFileSync(app.store.filePath,'utf8');
 const response=await realFetch(`http://127.0.0.1:${app.server.address().port}/v1/actions/${action.id}/execute`,{method:'POST',headers:{authorization:'Bearer synthetic-snapshot-token','content-type':'application/json'},body:'{}'});
 assert.equal(response.status,409);assert.match((await response.json()).error,/snapshot/i);assert.equal(constructed,0);assert.equal(outbound,0);assert.equal(action.execution,undefined);assert.equal(fs.readFileSync(app.store.filePath,'utf8'),bytes);
});
