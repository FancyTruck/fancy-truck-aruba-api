import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { JsonStateStore } from '../src/store.js';

test('actual forced-cycle endpoint never reports nondurable start/completion as success', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cycle-http-'));
  Object.assign(process.env,{APP_ENV:'test',PORT:'0',STATE_FILE:path.join(dir,'state.json'),API_TOKEN:'synthetic-cycle-token',
    READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',
    HELLO_EMAIL:'',HELLO_PASSWORD:'',PIETRO_EMAIL:'',PIETRO_PASSWORD:''});
  const app=await import('../src/server.js');
  if(!app.server.listening)await once(app.server,'listening');
  const originalSave=app.store.save,originalFetch=globalThis.fetch;let outbound=0;
  globalThis.fetch=async()=>{outbound++;throw Error('No provider access allowed');};
  t.after(async()=>{app.store.save=originalSave;globalThis.fetch=originalFetch;
    await new Promise(resolve=>app.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const headers={authorization:'Bearer synthetic-cycle-token','content-type':'application/json'};
  const run=()=>originalFetch(base+'/v1/automation/run',{method:'POST',headers,body:JSON.stringify({force:true})});
  app.store.setCursor('synthetic-source',{lastUid:12});
  app.store.save=()=>{throw Error('synthetic persistence unavailable');};
  assert.equal((await run()).status,500);
  assert.equal(app.store.state.cycles.length,0);
  assert.equal(new JsonStateStore(process.env.STATE_FILE).state.cycles.length,0);
  let writes=0;
  app.store.save=function(){if(++writes>1)throw Error('synthetic persistence unavailable');return originalSave.call(this);};
  assert.equal((await run()).status,500); // the process lock was released after the first failure
  assert.equal(writes,3); // persisted start, failed integration, failed error completion
  assert.equal(app.store.state.cycles.at(-1).status,'RUNNING');
  const reopened=new JsonStateStore(process.env.STATE_FILE);
  assert.equal(reopened.state.cycles.at(-1).status,'RUNNING');
  const response=await originalFetch(base+'/v1/diagnostics',{headers});
  assert.equal((await response.json()).last_cycle.status,'RUNNING');
  assert.equal(reopened.reconcileInterruptedCycles(),1);
  assert.equal(new JsonStateStore(process.env.STATE_FILE).state.cycles.at(-1).status,'INTERRUPTED');
  assert.deepEqual(reopened.state.cursors,{'synthetic-source':{lastUid:12}});
  assert.equal(outbound,0);
});
