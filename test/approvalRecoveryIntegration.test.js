import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {JsonStateStore} from '../src/store.js';
test('lost real HTTP approval responses recover without new action or external execution',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'approval-response-http-'));
 Object.assign(process.env,{APP_ENV:'test',PORT:'0',STATE_FILE:path.join(dir,'state.json'),API_TOKEN:'synthetic-recovery-token',READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false'});
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');
 const realFetch=globalThis.fetch;let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('No external calls');};
 const commit=app.store.commitApproval;
 t.after(async()=>{globalThis.fetch=realFetch;app.store.commitApproval=commit;await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const {action}=app.approvals.queue({type:'SEND_EMAIL',target:'synthetic@example.invalid',idempotency_key:'lost-http-response'});
 const base=`http://127.0.0.1:${app.server.address().port}/v1/approvals/${action.id}`;
 const post=(suffix,body,signal)=>realFetch(base+suffix,{method:'POST',headers:{authorization:'Bearer synthetic-recovery-token','content-type':'application/json'},body:JSON.stringify(body),signal});
 async function loseResponse(suffix,body){const controller=new AbortController();let committed=false;
  app.store.commitApproval=function(...args){const result=commit.apply(this,args);committed=true;controller.abort();return result;};
  try{await assert.rejects(post(suffix,body,controller.signal),e=>e.name==='AbortError');}finally{app.store.commitApproval=commit;}
  assert.equal(committed,true);
 }
 const command={actor:'Pietro',command:`APPROVA ${action.id}`};
 await loseResponse('/command',command);
 assert.equal(new JsonStateStore(process.env.STATE_FILE).action(action.id).status,'AWAITING_FINAL_CONFIRMATION');
 assert.throws(()=>app.approvals.assertExecutable(action.id));
 const retried=await post('/command',command);assert.equal(retried.status,200);const {confirmation_token}=await retried.json();
 await loseResponse('/confirm',{actor:'Pietro',confirmation_token});
 const disk=new JsonStateStore(process.env.STATE_FILE);assert.equal(disk.action(action.id).status,'APPROVED_FOR_EXECUTION');
 const before=app.store.snapshot(),bytes=fs.readFileSync(process.env.STATE_FILE,'utf8');
 const replay=await post('/confirm',{actor:'Pietro',confirmation_token});assert.equal(replay.status,200);
 assert.deepEqual(app.store.snapshot(),before);assert.equal(fs.readFileSync(process.env.STATE_FILE,'utf8'),bytes);
 assert.equal(before.events.filter(e=>e.type==='ACTION_FINAL_CONFIRMED').length,1);
 assert.equal(Object.keys(before.actions).length,1);assert.equal(outbound,0);
});
