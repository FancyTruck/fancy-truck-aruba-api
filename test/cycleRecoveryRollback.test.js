import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {JsonStateStore} from '../src/store.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cycle-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new JsonStateStore(path.join(dir,'state.json'));store.setCursor('synthetic',{lastUid:12});const first=store.beginCycle(['synthetic']),second=store.beginCycle(['synthetic']);store.state.actions.synthetic={status:'UNCERTAIN',execution:{kind:'smtp',id:'synthetic-attempt'}};store.save();return {store,first,second};}
for(const phase of ['writeFileSync','renameSync'])test(`${phase}: recovery failure restores held cycle/state references; retry persists exactly once`,t=>{
 const {store,first,second}=fixture(t);const before=store.snapshot(),state=store.state,cycles=store.state.cycles,actions=store.state.actions,action=actions.synthetic,events=store.state.events,bytes=fs.readFileSync(store.filePath,'utf8');
 const real=fs[phase];fs[phase]=(...args)=>{if(String(args[0]).startsWith(store.filePath))throw Error('Synthetic recovery disk failure');return real(...args);};
 try{assert.throws(()=>store.reconcileInterruptedCycles(),/disk failure/);}finally{fs[phase]=real;}
 assert.equal(first.status,'RUNNING');assert.equal(second.status,'RUNNING');assert.equal(store.state,state);assert.equal(store.state.cycles,cycles);assert.equal(store.state.actions,actions);assert.equal(store.state.actions.synthetic,action);assert.equal(store.state.events,events);assert.deepEqual(store.snapshot(),before);assert.equal(fs.readFileSync(store.filePath,'utf8'),bytes);
 assert.equal(store.reconcileInterruptedCycles(),2);assert.equal(first.status,'INTERRUPTED');assert.equal(second.status,'INTERRUPTED');assert.equal(store.reconcileInterruptedCycles(),0);
 const reopened=new JsonStateStore(store.filePath);assert.equal(reopened.state.events.filter(x=>x.type==='CYCLES_INTERRUPTED_ON_STARTUP').length,1);assert.deepEqual(reopened.state.cursors,before.cursors);assert.equal(reopened.state.actions.synthetic.status,'UNCERTAIN');
});
test('recovery serializes unrelated large state only once for persistence, without cloning it',t=>{
 const {store}=fixture(t);let serializations=0;const text='x'.repeat(2*1024*1024);store.state.actions.large={toJSON(){serializations++;return {synthetic:text};}};
 assert.equal(store.reconcileInterruptedCycles(),2);assert.equal(serializations,1);assert.equal(new JsonStateStore(store.filePath).state.actions.large.synthetic.length,text.length);
});
test('recovery failure at retention boundary restores original event/cycle arrays and held errors',t=>{
 const {store,first}=fixture(t);store.state.events=Array.from({length:2001},(_,i)=>({id:`synthetic-${i}`}));store.state.cycles.push(...Array.from({length:200},(_,i)=>({id:`old-${i}`,status:'COMPLETED'})));
 const cycles=store.state.cycles,events=store.state.events,errors=first.errors,before=store.snapshot();const real=fs.renameSync;fs.renameSync=()=>{throw Error('Synthetic rename failure');};try{assert.throws(()=>store.reconcileInterruptedCycles(),/rename failure/);}finally{fs.renameSync=real;}
 assert.equal(store.state.cycles,cycles);assert.equal(store.state.events,events);assert.equal(first.status,'RUNNING');assert.deepEqual(first.errors,errors);assert.deepEqual(store.snapshot(),before);
});
test('completed-only state recovery is readonly',t=>{
 const {store}=fixture(t);for(const c of store.state.cycles)c.status='COMPLETED';store.save=()=>assert.fail('No recovery save');assert.equal(store.reconcileInterruptedCycles(),0);
});
test('actual owner startup aborts on recovery persistence failure; next startup recovers without providers',t=>{
 const {store}=fixture(t);const before=fs.readFileSync(store.filePath,'utf8');
 const script=`import fs from 'node:fs';import nodemailer from 'nodemailer';import {once} from 'node:events';globalThis.fetch=()=>{throw Error('Provider forbidden');};nodemailer.createTransport=()=>{throw Error('SMTP forbidden');};if(process.env.FAIL_RECOVERY==='true')fs.renameSync=()=>{throw Error('Synthetic startup disk failure');};try{const app=await import('./src/server.js');if(!app.server.listening)await once(app.server,'listening');console.log('RESULT:'+JSON.stringify(app.store.state.cycles.map(c=>c.status)));await new Promise(r=>app.server.close(r));}catch(e){console.log('ABORT:'+e.message);}`;
 const run=fail=>execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),timeout:10000,encoding:'utf8',env:{PATH:process.env.PATH,APP_ENV:'test',STATE_FILE:store.filePath,PORT:'0',API_TOKEN:'synthetic',READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',FAIL_RECOVERY:String(fail)}});
 assert.match(run(true),/ABORT:Synthetic startup disk failure/);assert.equal(fs.readFileSync(store.filePath,'utf8'),before);assert.match(run(false),/RESULT:\["INTERRUPTED","INTERRUPTED"\]/);assert.equal(new JsonStateStore(store.filePath).state.actions.synthetic.status,'UNCERTAIN');
});
