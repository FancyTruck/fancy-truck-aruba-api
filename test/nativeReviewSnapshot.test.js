import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {hash} from '../src/peuCommon.js';
import {JsonStateStore} from '../src/store.js';

test('actual native review HTTP closure binds the displayed review and interrupted operation',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-review-snapshot-'));
 Object.assign(process.env,{APP_ENV:'test',PORT:'0',STATE_FILE:path.join(dir,'state.json'),API_TOKEN:'synthetic-review-admin',REVIEW_READ_TOKEN:'synthetic-review-read',REVIEW_WRITE_TOKEN:'synthetic-review-write',READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false'});
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');const realFetch=globalThis.fetch;let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('No provider calls');};const save=app.store.save;
 t.after(async()=>{app.store.save=save;globalThis.fetch=realFetch;await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}/v1/classification-reviews`;
 const headers=token=>({authorization:`Bearer ${token||'synthetic-review-write'}`,'content-type':'application/json'});
 const list=async()=>{const r=await realFetch(base,{headers:headers()});assert.equal(r.headers.get('cache-control'),'no-store');return (await r.json()).items;};
 const queue=(key,operation)=>{if(operation)app.store.saveMailOperation(key,{status:'STARTED',account:'synthetic',uid:1,validity:'42'});return app.store.queueClassification({source_key:key,subject:'Synthetic',reason:'previous_operation_outcome_uncertain',...(operation?{operation_id:key}:{})}).item;};
 const snapshot=async row=>(await list()).find(x=>x.id===row.id).snapshot_hash||hash({review:row,operation:row.operation_id?app.store.state.mail_operations[row.operation_id]??null:null});
 const close=(row,snapshot_hash,token)=>realFetch(`${base}/${row.id}/resolve`,{method:'POST',headers:headers(token),body:JSON.stringify({resolution:'HANDLED_MANUALLY',note:'Synthetic manual verification only',snapshot_hash})});
 await t.test('missing and cross-case snapshots reject without state writes',async()=>{
  const a=queue('missing'),b=queue('cross');const bHash=await snapshot(b),before=fs.readFileSync(app.store.filePath,'utf8');
  assert.equal((await close(a,undefined)).status,409);assert.equal((await close(a,bHash)).status,409);assert.equal(fs.readFileSync(app.store.filePath,'utf8'),before);
 });
 await t.test('stale displayed review rejects after metadata changes',async()=>{
  const row=queue('review-change'),old=await snapshot(row);row.candidate_ids=[101,102];app.store.save();const before=fs.readFileSync(app.store.filePath,'utf8');
  assert.equal((await close(row,old)).status,409);assert.equal(fs.readFileSync(app.store.filePath,'utf8'),before);assert.equal(row.status,'DA_CLASSIFICARE');
 });
 await t.test('unchanged review cannot close a changed interrupted operation',async()=>{
  const row=queue('operation-change',true),old=await snapshot(row);app.store.saveMailOperation(row.operation_id,{...app.store.state.mail_operations[row.operation_id],provider_reference:'synthetic-new-evidence'});const before=fs.readFileSync(app.store.filePath,'utf8');
  assert.equal((await close(row,old)).status,409);assert.equal(fs.readFileSync(app.store.filePath,'utf8'),before);assert.equal(app.store.state.mail_operations[row.operation_id].status,'STARTED');
 });
 await t.test('exact current snapshot closes durably without effects; replay does not write',async()=>{
  const row=queue('exact',true),current=await snapshot(row);assert.equal((await close(row,current)).status,200);const bytes=fs.readFileSync(app.store.filePath,'utf8');
  const disk=new JsonStateStore(app.store.filePath);assert.equal(disk.state.classification_reviews[row.id].status,'RESOLVED');assert.equal(disk.state.mail_operations[row.operation_id].status,'COMPLETED');
  assert.equal((await close(row,current)).status,409);assert.equal(fs.readFileSync(app.store.filePath,'utf8'),bytes);
 });
 await t.test('failed save leaves same snapshot retryable after rollback',async()=>{
  const row=queue('disk-failure',true),current=await snapshot(row),before=fs.readFileSync(app.store.filePath,'utf8');app.store.save=()=>{throw Error('Synthetic disk failure');};
  try{assert.equal((await close(row,current)).status,409);}finally{app.store.save=save;}
  assert.equal(fs.readFileSync(app.store.filePath,'utf8'),before);assert.equal(app.store.state.classification_reviews[row.id].status,'DA_CLASSIFICARE');assert.equal(app.store.state.mail_operations[row.operation_id].status,'STARTED');
  assert.equal((await close(row,current)).status,200);
 });
 await t.test('listing returns a reproducible case-and-operation digest; reader cannot resolve',async()=>{
  const row=queue('reader',true),item=(await list()).find(x=>x.id===row.id);assert.match(item.snapshot_hash,/^[a-f0-9]{64}$/);
  assert.equal(item.snapshot_hash,hash({review:row,operation:app.store.state.mail_operations[row.operation_id]}));
  const before=fs.readFileSync(app.store.filePath,'utf8');assert.equal((await close(row,item.snapshot_hash,'synthetic-review-read')).status,403);assert.equal(fs.readFileSync(app.store.filePath,'utf8'),before);
 });
 assert.equal(outbound,0);
});
