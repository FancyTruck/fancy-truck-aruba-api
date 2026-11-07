import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {automationHealth} from '../src/automationHealth.js';
import {intakeStatus,syncIntakeWatchdog} from '../src/intakeWatchdog.js';
import {JsonStateStore} from '../src/store.js';

const now=Date.parse('2026-11-07T10:00:00Z');
const completed={id:'recent',status:'COMPLETED',started_at:new Date(now-2000).toISOString(),ended_at:new Date(now-1000).toISOString(),failed:0,suspended:0};
const pending=started_at=>({id:'pending',status:'RUNNING',started_at,ended_at:null,errors:[]});
const health=cycles=>automationHealth({runtime:{readOnly:false,automationEnabled:true},cycles,operatingNow:false,startedAt:now,now});

test('fresh completed cycle cannot hide older stalled work retained beyond recent history',()=>{
 const cycles=[pending(new Date(now-3*3600000).toISOString()),...Array.from({length:201},()=>({...completed}))],before=JSON.stringify(cycles);
 const result=health(cycles);assert.equal(result.status,'DEGRADED');assert.equal(result.stale,true);
 assert(result.reasons.includes('CYCLE_STALLED'));assert.equal(result.running_cycles,1);assert.equal(result.stalled_cycles,1);
 assert.equal(result.lastCycle,cycles.at(-1));assert.equal(JSON.stringify(cycles),before);
});

test('fresh unfinished work anywhere in history reports RUNNING instead of verified OK',()=>{
 const result=health([pending(new Date(now-10000).toISOString()),completed]);
 assert.equal(result.status,'RUNNING');assert.equal(result.running_cycles,1);assert.equal(result.stalled_cycles,0);assert.equal(result.stale,false);
 assert.equal(health([completed]).status,'OK');
});

test('watchdog counts older stalled and unparseable pending cycles without clearing its activity',async()=>{
 const state={cycles:[pending('invalid'),pending(new Date(now-30*60000).toISOString()),completed]},before=JSON.stringify(state);
 const status=intakeStatus(state,{now,operating:false});assert.equal(status.ok,false);
 assert.equal(status.running_cycles,2);assert.equal(status.stalled_cycles,2);
 assert.deepEqual(status.issues,[{code:'CYCLE_STALLED',count:2}]);
 let note='',writes=0;
 const call=async(model,method,args)=>{
  if(model==='res.users')return [{id:2,partner_id:[3,'Synthetic owner']}];
  assert.equal(model,'mail.activity');if(method==='search_read')return [{id:9,note}];
  assert.equal(method,'write');writes++;note=args[1].note;return true;
 };
 assert.equal((await syncIntakeWatchdog({state,call,login:'synthetic',now,operating:false})).status,'ATTENTION');
 assert.doesNotMatch(note,/Controlli rientrati/);assert.match(note,/Cicl/);
 await syncIntakeWatchdog({state,call,login:'synthetic',now,operating:false});assert.equal(writes,1);
 assert.equal(JSON.stringify(state),before);
});

test('real readonly HTTP diagnostics expose old pending backlog without recovery, writes or providers',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pending-diag-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'state.json'),store=new JsonStateStore(file),at=Date.now();
 store.state.cycles=[pending(new Date(at-3*3600000).toISOString()),...Array.from({length:201},()=>({...completed,started_at:new Date(at-2000).toISOString(),ended_at:new Date(at-1000).toISOString()}))];store.save();
 const before=fs.readFileSync(file,'utf8');
 const script=`
  import {once} from 'node:events';import nodemailer from 'nodemailer';
  const http=globalThis.fetch;let outbound=0;globalThis.fetch=()=>{outbound++;throw Error('Provider forbidden');};nodemailer.createTransport=()=>{outbound++;throw Error('SMTP forbidden');};
  const {server}=await import('./src/server.js');if(!server.listening)await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port,headers={authorization:'Bearer synthetic'};
  const diagnostics=await(await http(base+'/v1/diagnostics',{headers})).json(),intake=await(await http(base+'/v1/intake/status',{headers})).json();
  console.log('RESULT:'+JSON.stringify({diagnostics,intake,outbound,health:(await http(base+'/health')).status}));
  await new Promise(resolve=>server.close(resolve));
 `;
 const output=execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000,
  env:{PATH:process.env.PATH,APP_ENV:'test',STATE_FILE:file,PORT:'0',API_TOKEN:'synthetic',READ_ONLY:'true',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false'}});
 const {diagnostics,intake,outbound,health:live}=JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT:')).slice(7));
 assert.equal(diagnostics.automation_status,'DISABLED');assert(diagnostics.automation_reasons.includes('CYCLE_STALLED'));
 assert.equal(diagnostics.automation_running_cycles,1);assert.equal(diagnostics.automation_stalled_cycles,1);assert.equal(diagnostics.automation_stale,true);
 assert.equal(intake.ok,false);assert.equal(intake.stalled_cycles,1);assert.equal(intake.last_cycle.status,'COMPLETED');
 assert.equal(outbound,0);assert.equal(live,200);assert.equal(fs.readFileSync(file,'utf8'),before);
});
