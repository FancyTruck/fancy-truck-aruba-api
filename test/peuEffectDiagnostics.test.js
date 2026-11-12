import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {openMailDb} from '../src/peuMailDb.js';
const schema=`CREATE TABLE peu_effects(action_id TEXT PRIMARY KEY,digest TEXT,status TEXT,result TEXT);
 CREATE TABLE peu_operations(key TEXT PRIMARY KEY,digest TEXT,status TEXT,result TEXT);`;
test('ledger projection counts effects and requests separately without returning stored bodies',async t=>{
 const {peuEffectDiagnostics}=await import('../src/peuEffectDiagnostics.js');const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(schema);
 for(const table of ['peu_effects','peu_operations'])for(const status of ['unknown','executing','succeeded','failed'])db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?)`).run(status,'synthetic',status,'private-body');
 const before=db.prepare('SELECT * FROM peu_effects').all();
 assert.deepEqual(peuEffectDiagnostics(db),{status:'REVIEW_REQUIRED',effects:{executing:1,unknown:1},requests:{executing:1,unknown:1}});
 assert.deepEqual(db.prepare('SELECT * FROM peu_effects').all(),before);
 db.exec("DELETE FROM peu_effects WHERE status='unknown';DELETE FROM peu_operations WHERE status='unknown'");assert.equal(peuEffectDiagnostics(db).status,'IN_PROGRESS');
 db.exec("DELETE FROM peu_effects WHERE status='executing';DELETE FROM peu_operations WHERE status='executing'");assert.equal(peuEffectDiagnostics(db).status,'NO_UNRESOLVED_ENTRIES');
});
test('missing or unreadable ledgers are unavailable, never silently zero or repaired',async t=>{
 const {peuEffectDiagnostics}=await import('../src/peuEffectDiagnostics.js');const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 assert.equal(peuEffectDiagnostics().status,'NOT_AVAILABLE');assert.deepEqual(peuEffectDiagnostics(db),{status:'UNAVAILABLE',effects:null,requests:null});assert.equal(db.prepare('SELECT count(*) n FROM sqlite_master').get().n,0);
 assert.equal(peuEffectDiagnostics({prepare(){throw Error('private provider detail');}}).status,'UNAVAILABLE');
});
test('actual readonly admin diagnostics expose uncertain Peu counts without provider calls or ledger changes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peu-diagnostics-')),dbFile=path.join(dir,'peu-aruba.sqlite'),db=openMailDb(dbFile);db.exec(schema);
 db.prepare('INSERT INTO peu_effects VALUES(?,?,?,?)').run('private-id','private-digest','unknown','private-body');db.prepare('INSERT INTO peu_operations VALUES(?,?,?,?)').run('private-key','private-digest','executing','private-body');db.close();const bytes=fs.readFileSync(dbFile);
 Object.assign(process.env,{APP_ENV:'test',STATE_FILE:path.join(dir,'state.json'),READ_ONLY:'true',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',PORT:'0',API_TOKEN:'fixture-admin',PEU_ACCESS_TOKEN:'fixture-peu',PIETRO_EMAIL:'fixture@example.invalid',PIETRO_PASSWORD:'synthetic'});
 const fetcher=globalThis.fetch;let providers=0;globalThis.fetch=async()=>{providers++;throw Error('No provider allowed');};
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');
 t.after(async()=>{globalThis.fetch=fetcher;await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 assert.equal((await fetcher(base+'/v1/diagnostics',{headers:{authorization:'Bearer fixture-peu'}})).status,403);
 const response=await fetcher(base+'/v1/diagnostics',{headers:{authorization:'Bearer fixture-admin'}});assert.equal(response.status,200);
 const data=await response.json();assert.deepEqual(data.peu_effect_ledger,{status:'REVIEW_REQUIRED',effects:{executing:0,unknown:1},requests:{executing:1,unknown:0}});
 assert(!JSON.stringify(data.peu_effect_ledger).includes('private-'));assert.equal(providers,0);assert.deepEqual(fs.readFileSync(dbFile),bytes);
});
