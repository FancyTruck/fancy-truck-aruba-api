import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import nodemailer from 'nodemailer';
import {JsonStateStore} from '../src/store.js';

test('actual generic execution HTTP route claims durably before mock SMTP',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smtp-claim-http-'));
 Object.assign(process.env,{APP_ENV:'test',PORT:'0',STATE_FILE:path.join(dir,'state.json'),API_TOKEN:'synthetic-smtp-token',READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',HELLO_EMAIL:'sender@example.invalid',HELLO_PASSWORD:'synthetic-only'});
 const originalTransport=nodemailer.createTransport,realFetch=globalThis.fetch;
 let calls=0,behavior,observed;
 nodemailer.createTransport=()=>({sendMail:async payload=>{calls++;observed=payload;return behavior(payload);}});
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');
 let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('No provider calls');};
 const originalSave=app.store.save;
 t.after(async()=>{app.store.save=originalSave;nodemailer.createTransport=originalTransport;globalThis.fetch=realFetch;await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 function approved(key){const {action}=app.approvals.queue({type:'SEND_EMAIL',target:'recipient@example.invalid',idempotency_key:key,payload:{account:'hello',subject:'Synthetic test',text:'No network'}});const c=app.approvals.approveCommand(action.id,'Pietro',`APPROVA ${action.id}`);app.approvals.confirm(action.id,'Pietro',c.confirmation_token);return action;}
 const post=id=>realFetch(`http://127.0.0.1:${app.server.address().port}/v1/actions/${id}/execute`,{method:'POST',headers:{authorization:'Bearer synthetic-smtp-token','content-type':'application/json'},body:'{}'});
 const accepted=p=>({messageId:p.messageId,accepted:['recipient@example.invalid'],rejected:[]});
 await t.test('overlapping requests call SMTP once and persist the claim before awaiting',async()=>{
  const action=approved('overlap');let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let sends=0;
  behavior=async p=>{sends++;entered();if(sends===1)await gate;return accepted(p);};
  const first=post(action.id);await ready;
  try {const second=await post(action.id);assert.equal(second.status,409);assert.equal(sends,1);assert.equal(new JsonStateStore(app.store.filePath).action(action.id).status,'EXECUTING');}
  finally {release();await first;}
 });
 await t.test('timeout never authorizes a retry, including after reopening',async()=>{
  const action=approved('timeout'),before=calls;behavior=async()=>{throw Error('Synthetic timeout');};
  assert.equal((await post(action.id)).status,409);
  assert.equal(new JsonStateStore(app.store.filePath).action(action.id).status,'UNCERTAIN');
  assert.equal((await post(action.id)).status,409);assert.equal(calls,before+1);
 });
 await t.test('complete SMTP acceptance is durable but does not claim delivery',async()=>{
  const action=approved('accepted');behavior=async p=>{const disk=new JsonStateStore(app.store.filePath).action(action.id);assert.equal(disk.status,'EXECUTING');assert.equal(disk.execution.message_id,p.messageId);return accepted(p);};
  const response=await post(action.id);assert.equal(response.status,200);const {action:result}=await response.json();
  assert.equal(result.status,'EXECUTED');assert.equal(result.result.delivery_verified,false);assert.equal(result.result.status,'accepted_by_smtp');
  assert.match(observed.messageId,/^<fancy-[a-f0-9-]+@fancytruck\.it>$/);
  assert.equal(new JsonStateStore(app.store.filePath).action(action.id).status,'EXECUTED');
  assert.equal((await post(action.id)).status,409);
 });
 await t.test('partial recipient acceptance enters uncertainty and cannot resend accepted recipients',async()=>{
  const action=approved('partial'),before=calls;behavior=async p=>({...accepted(p),rejected:['other@example.invalid']});
  assert.equal((await post(action.id)).status,409);assert.equal(action.status,'UNCERTAIN');
  assert.deepEqual(action.result.provider_observation.accepted,['recipient@example.invalid']);
  assert.deepEqual(action.result.provider_observation.rejected,['other@example.invalid']);
  assert.equal((await post(action.id)).status,409);assert.equal(calls,before+1);
 });
 await t.test('failed claim persistence prevents even a mock SMTP call and leaves approval retryable',async()=>{
  const action=approved('claim-failure'),before=calls;behavior=async p=>accepted(p);
  app.store.save=()=>{throw Error('Synthetic unavailable disk');};
  try {assert.equal((await post(action.id)).status,409);assert.equal(calls,before);assert.equal(action.status,'APPROVED_FOR_EXECUTION');assert.equal(action.execution,undefined);}
  finally {app.store.save=originalSave;}
 });
 await t.test('failed result persistence leaves a durable nonretryable claim',async()=>{
  const action=approved('result-failure'),before=calls;
  behavior=async p=>{app.store.save=()=>{throw Error('Synthetic unavailable disk after SMTP');};return accepted(p);};
  try {assert.equal((await post(action.id)).status,409);assert.equal(new JsonStateStore(app.store.filePath).action(action.id).status,'EXECUTING');assert.equal((await post(action.id)).status,409);assert.equal(calls,before+1);}
  finally {app.store.save=originalSave;}
 });
 assert.equal(outbound,0);
});
