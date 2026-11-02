import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {intakeStatus,syncIntakeWatchdog} from '../src/intakeWatchdog.js';
import {JsonStateStore} from '../src/store.js';

const uncertain = {id:'synthetic-action',status:'UNCERTAIN',execution:{kind:'smtp',id:'synthetic-attempt',message_id:'<synthetic@example.invalid>',started_at:'2026-11-02T00:00:00Z'},payload:{to:'private@example.invalid',text:'private body'},result:{status:'partial_or_unverified_acceptance',response:'private provider text'}};
test('uncertain SMTP is actionable diagnostics, without exposing payload or implying delivery',()=>{
 const state={actions:{a:structuredClone(uncertain)}};const before=JSON.stringify(state);
 const status=intakeStatus(state);
 assert.equal(status.ok,false);assert.deepEqual(status.issues,[{code:'SMTP_OUTCOMES_UNCERTAIN',count:1}]);
 assert.deepEqual(status.smtp_uncertain,[{action_id:'synthetic-action',execution_id:'synthetic-attempt',message_id:'<synthetic@example.invalid>',started_at:'2026-11-02T00:00:00Z',delivery_verified:false}]);
 assert.equal(JSON.stringify(status).includes('private'),false);assert.equal(JSON.stringify(state),before);
});
test('SMTP diagnostics exclude successful, active and unrelated uncertain operations; legacy attempt stays visible',()=>{
 const actions={legacy:{id:'legacy',status:'UNCERTAIN',execution:{kind:'smtp'}}};
 for(const status of ['EXECUTED','EXECUTING','APPROVED_FOR_EXECUTION','CANCELLED'])actions[status]={...uncertain,status};
 actions.other={id:'other',status:'UNCERTAIN',execution:{kind:'odoo'}};
 const status=intakeStatus({actions});assert.deepEqual(status.issues,[{code:'SMTP_OUTCOMES_UNCERTAIN',count:1}]);
 assert.equal(status.smtp_uncertain[0].action_id,'legacy');assert.equal(status.smtp_uncertain[0].execution_id,null);
 assert.equal(intakeStatus({}).ok,true);
});
test('existing watchdog activity describes blocked SMTP and remains stable on repeat, without an execution call',async()=>{
 let note='',writes=0;const state={actions:{a:uncertain}};const before=JSON.stringify(state);
 const call=async(model,method,args)=>{
  if(model==='res.users')return [{id:2,partner_id:[3,'Synthetic owner']}];
  assert.equal(model,'mail.activity');
  if(method==='search_read')return [{id:9,note}];
  assert.equal(method,'write');writes++;note=args[1].note;return true;
 };
 const result=await syncIntakeWatchdog({state,call,login:'synthetic-owner'});
 assert.equal(result.status,'ATTENTION');assert.match(note,/SMTP.*incerto/);assert.doesNotMatch(note,/Controlli rientrati|private/);
 await syncIntakeWatchdog({state,call,login:'synthetic-owner'});assert.equal(writes,1);assert.equal(JSON.stringify(state),before);
});
test('real readonly intake HTTP route reports persisted SMTP uncertainty without altering or retrying it',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smtp-diag-'));const file=path.join(dir,'state.json');
 const seed=new JsonStateStore(file);const {action}=seed.createAction({type:'email.send',target:'synthetic',payload:{to:'private@example.invalid',text:'private body'},idempotency_key:'synthetic-diag',status:'APPROVED_FOR_EXECUTION'});
 const attempt=seed.beginSmtpExecution(action.id);seed.finishSmtpExecution(action.id,attempt.id,'UNCERTAIN',{status:'timeout'});const bytes=fs.readFileSync(file,'utf8');
 Object.assign(process.env,{APP_ENV:'test',PORT:'0',STATE_FILE:file,API_TOKEN:'synthetic-diag-token',READ_ONLY:'true',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false'});
 const realFetch=globalThis.fetch;let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('Provider forbidden');};
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');
 t.after(async()=>{globalThis.fetch=realFetch;await new Promise(resolve=>app.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 const response=await realFetch(`http://127.0.0.1:${app.server.address().port}/v1/intake/status`,{headers:{authorization:'Bearer synthetic-diag-token'}});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.ok,false);assert.equal(data.smtp_uncertain[0].execution_id,attempt.id);
 assert.equal(JSON.stringify(data).includes('private'),false);assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(new JsonStateStore(file).action(action.id).status,'UNCERTAIN');assert.equal(outbound,0);
});
