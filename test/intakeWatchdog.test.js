import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeStatus,syncIntakeWatchdog,suspensionDescription} from '../src/intakeWatchdog.js';
import {JsonStateStore} from '../src/store.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('watchdog detects stalled cycles, uncertain writes, unresolved replies and blocked mail',()=>{
 const now=Date.now();const state={cycles:[{status:'RUNNING',started_at:new Date(now-100*60e3).toISOString()}],classification_reviews:{m:{status:'DA_CLASSIFICARE',reason:'reply_without_matching_lead'}},mail_operations:{a:{status:'STARTED'}},mail_outcomes:{b:{status:'RETRY_PENDING'}}};
 assert.deepEqual(intakeStatus(state,{now,operating:true}).issues.map(x=>x.code),['REVIEWS_PENDING','UNCERTAIN_WRITES','CYCLE_STALLED','POLLING_OVERDUE','MESSAGES_BLOCKED']);
 assert.equal(intakeStatus({}, {operating:false}).ok,true);
 assert.match(suspensionDescription({reason:'reply_without_matching_lead'}),/Risposta cliente/);
 assert.equal(intakeStatus({cycles:[{status:'INTERRUPTED'}]}).issues[0].code,'CYCLE_FAILED');
});
test('watchdog updates one internal activity, escapes mail text and never sends',async()=>{
 let activity;let creates=0;const call=async(m,f,a,o)=>{
 if(m==='res.users')return [{id:2,partner_id:[3,'Owner']}];
 if(m==='ir.model'||m==='mail.activity.type')return [{id:1}];
 assert.equal(m,'mail.activity');if(f==='search_read')return activity?[activity]:[];
 assert.equal(o.context.mail_activity_quick_update,true);
 if(f==='create'){creates++;activity={id:9,note:a[0][0].note};return [9];}
 if(f==='write'){activity.note=a[1].note;return true;}throw Error('Unexpected write '+f);
 };
 const state={classification_reviews:{a:{status:'DA_CLASSIFICARE',subject:'<script>bad</script>',sender:'x',reason:'reply_without_matching_lead'}}};
 await syncIntakeWatchdog({state,call,login:'owner'});await syncIntakeWatchdog({state,call,login:'owner'});
 assert.equal(creates,1);assert.ok(activity.note.includes('&lt;script&gt;'));
 await syncIntakeWatchdog({state:{},call,login:'owner'});assert.match(activity.note,/Controlli rientrati/);
});
test('outcome ledger persists and failed persistence rolls back',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'intake-ledger-'));
 try { const store=new JsonStateStore(path.join(dir,'state.json'));store.recordMailOutcome('hello','1',2,{skipped:true,reason:'supplier_offer'});
 assert.equal(Object.values(new JsonStateStore(store.filePath).state.mail_outcomes)[0].status,'EXCLUDED');
 const previous=JSON.stringify(store.state.mail_outcomes);store.save=()=>{throw Error('disk');};
 assert.throws(()=>store.recordMailOutcome('hello','1',3,{lead_id:507}),/disk/);assert.equal(JSON.stringify(store.state.mail_outcomes),previous);
 } finally {fs.rmSync(dir,{recursive:true});}
});
