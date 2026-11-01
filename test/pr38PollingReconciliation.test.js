import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {JsonStateStore} from '../src/store.js';
import {pollMailbox,MAX_INLINE_SOURCE_BYTES} from '../src/mailPolling.js';
import {intakeStatus} from '../src/intakeWatchdog.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pr38-reconcile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new JsonStateStore(path.join(dir,'state.json'));let bodies=0;return {store,account:'hello',now:Date.UTC(2026,10,1),client:{mailbox:{uidValidity:42},search:async()=>[1],fetchOne:async(_,q)=>{assert(q.size,'large MIME must not be fetched');return {size:MAX_INLINE_SOURCE_BYTES+1,envelope:{subject:'Synthetic',messageId:'<synthetic@example.invalid>',from:[{address:'synthetic@example.invalid'}]}};}},parse:()=>{bodies++;assert.fail('No large MIME parse');},processMessage:()=>assert.fail('No provider action'),get bodies(){return bodies;}};}
for(const phase of ['review','outcome','checkpoint'])test(`${phase} persistence failure retains UID; reopened retry reuses one durable review`,async t=>{
 const f=fixture(t),store=f.store,key='imap:hello:checkpoint';const original={save:store.save,record:store.recordMailOutcome,cursor:store.setCursor};let failed=false;
 if(phase==='review')store.save=function(){if(!failed&&Object.keys(this.state.classification_reviews).length){failed=true;throw Error('Synthetic review persistence failure');}return original.save.call(this);};
 if(phase==='outcome')store.recordMailOutcome=function(...args){if(!failed){failed=true;throw Error('Synthetic outcome persistence failure');}return original.record.apply(this,args);};
 if(phase==='checkpoint')store.setCursor=function(name,value){if(!failed&&value.lastUid===1){failed=true;throw Error('Synthetic checkpoint persistence failure');}return original.cursor.call(this,name,value);};
 const first=await pollMailbox(f);assert.equal(failed,true);assert.equal(first[0].retry_pending,true);assert.equal(store.cursor(key).lastUid,0);
 const reopened=new JsonStateStore(store.filePath);assert.equal(reopened.cursor(key).lastUid,0);const reviews=Object.values(reopened.state.classification_reviews),priorId=reviews[0]?.id;
 const second=await pollMailbox({...f,store:reopened});assert.equal(second[0].suspended,true);assert.equal(second[0].content_processed,false);assert.equal(reopened.cursor(key).lastUid,1);
 const final=new JsonStateStore(store.filePath),rows=Object.values(final.state.classification_reviews);assert.equal(rows.length,1);if(priorId)assert.equal(rows[0].id,priorId);
 const outcome=Object.values(final.state.mail_outcomes)[0];assert.equal(outcome.status,'REVIEW');assert.equal(outcome.content_processed,false);assert.notEqual(outcome.status,'PROCESSED');assert.equal(intakeStatus(final.state).issues.some(x=>x.code==='REVIEWS_PENDING'),true);assert.equal(f.bodies,0);
});
test('sent-folder review retains exact account, folder, UIDVALIDITY and UID for recovery',async t=>{
 const f=fixture(t);f.account='hello:sent:INBOX.Sent';await pollMailbox(f);const row=Object.values(new JsonStateStore(f.store.filePath).state.classification_reviews)[0];assert.equal(row.account,'hello');assert.equal(row.mailbox,'INBOX.Sent');assert.equal(row.uid,1);assert.equal(row.uid_validity,'42');assert.equal(row.message_id,'<synthetic@example.invalid>');assert.equal(row.status,'DA_CLASSIFICARE');assert.equal(f.bodies,0);
});
