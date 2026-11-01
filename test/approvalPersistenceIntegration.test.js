import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {JsonStateStore} from '../src/store.js';

test('actual approval HTTP endpoints reject failed commits without granting execution',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'approval-http-'));
 Object.assign(process.env,{APP_ENV:'test',PORT:'0',STATE_FILE:path.join(dir,'state.json'),API_TOKEN:'synthetic-approval-token',
  READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false'});
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');
 const realFetch=globalThis.fetch;let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('No provider calls');};
 t.after(async()=>{globalThis.fetch=realFetch;await new Promise(resolve=>app.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 const {action}=app.approvals.queue({type:'SEND_EMAIL',target:'synthetic@example.invalid',idempotency_key:'http-approval',payload:{text:'synthetic'}});
 const base=`http://127.0.0.1:${app.server.address().port}/v1/approvals/${action.id}`;
 const post=(suffix,body)=>realFetch(base+suffix,{method:'POST',headers:{authorization:'Bearer synthetic-approval-token','content-type':'application/json'},body:JSON.stringify(body)});
 async function rejected(suffix,body){const rename=fs.renameSync;
  fs.renameSync=(...args)=>{if(String(args[0]).startsWith(process.env.STATE_FILE))throw Error('synthetic disk unavailable');return rename(...args);};
  try{assert.equal((await post(suffix,body)).status,409);}finally{fs.renameSync=rename;}
 }
 const command={actor:'Pietro',command:`APPROVA ${action.id}`},before=app.store.snapshot();
 await rejected('/command',command);assert.deepEqual(app.store.snapshot(),before);
 assert.equal(new JsonStateStore(process.env.STATE_FILE).action(action.id).status,'PENDING_APPROVAL');
 const response=await post('/command',command);assert.equal(response.status,200);
 const result=await response.json();const awaiting=app.store.snapshot();
 await rejected('/confirm',{actor:'Pietro',confirmation_token:result.confirmation_token});
 assert.deepEqual(app.store.snapshot(),awaiting);assert.throws(()=>app.approvals.assertExecutable(action.id));
 assert.equal(new JsonStateStore(process.env.STATE_FILE).action(action.id).status,'AWAITING_FINAL_CONFIRMATION');
 const confirmed=await post('/confirm',{actor:'Pietro',confirmation_token:result.confirmation_token});
 assert.equal(confirmed.status,200);assert.equal(app.approvals.assertExecutable(action.id).status,'APPROVED_FOR_EXECUTION');
 assert.equal(app.store.state.events.filter(e=>e.type==='ACTION_FINAL_CONFIRMED').length,1);
 assert.equal(outbound,0); // no execution endpoint was invoked
});
