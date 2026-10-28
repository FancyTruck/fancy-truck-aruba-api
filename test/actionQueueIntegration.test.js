import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {JsonStateStore} from '../src/store.js';
test('actual mail preparation HTTP: failed queue is absent, retry persists once and replay stays read-only',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'queue-http-'));Object.assign(process.env,{APP_ENV:'test',PORT:'0',STATE_FILE:path.join(dir,'state.json'),API_TOKEN:'synthetic-queue-token',READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false'});
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');app.store.save();
 const realFetch=globalThis.fetch,realRename=fs.renameSync;let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('No provider calls');};
 t.after(async()=>{fs.renameSync=realRename;globalThis.fetch=realFetch;await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const before=app.store.snapshot();
 const post=()=>realFetch(`http://127.0.0.1:${app.server.address().port}/v1/hello/send`,{method:'POST',headers:{authorization:'Bearer synthetic-queue-token','content-type':'application/json'},body:JSON.stringify({to:'synthetic@example.invalid',subject:'Synthetic queue',text:'No send',idempotency_key:'synthetic-retry'})});
 fs.renameSync=(...args)=>{if(String(args[0]).startsWith(app.store.filePath))throw Error('Synthetic disk failure');return realRename(...args);};
 try{assert.equal((await post()).status,400);assert.deepEqual(app.store.snapshot(),before);assert.deepEqual(new JsonStateStore(app.store.filePath).snapshot(),before);}finally{fs.renameSync=realRename;}
 const response=await post();assert.equal(response.status,202);const queued=await response.json();assert.equal(queued.duplicate,false);assert.equal(queued.sent,false);assert.equal(queued.action.status,'PENDING_APPROVAL');
 const bytes=fs.readFileSync(app.store.filePath,'utf8'),again=await (await post()).json();assert.equal(again.duplicate,true);assert.equal(again.action.id,queued.action.id);assert.equal(fs.readFileSync(app.store.filePath,'utf8'),bytes);
 assert.equal(Object.keys(new JsonStateStore(app.store.filePath).state.actions).length,1);assert.equal(outbound,0);
});
