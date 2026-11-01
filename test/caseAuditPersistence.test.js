import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {JsonStateStore} from '../src/store.js';
import {runMailOperation} from '../src/mailOperations.js';
import {linkThreadMessage} from '../src/threadLinking.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-audit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new JsonStateStore(path.join(dir,'state.json'));store.save();return store;}
function fail(store,phase,fn){const real=fs[phase];fs[phase]=(...args)=>{if(String(args[0]).startsWith(store.filePath))throw Error('Synthetic disk failure');return real(...args);};try{assert.throws(fn,/Synthetic disk failure/);}finally{fs[phase]=real;}}
for(const phase of ['writeFileSync','renameSync']){
 test(`${phase}: standalone audit failure leaves no phantom event in memory or disk`,t=>{const store=fixture(t),before=store.snapshot();fail(store,phase,()=>store.audit('SYNTHETIC_EVENT',{result:'synthetic'}));assert.deepEqual(store.snapshot(),before);assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);});
 test(`${phase}: failed case creation rolls back case and creation audit; retry is not a duplicate`,t=>{const store=fixture(t),before=store.snapshot(),input={id:'synthetic-case',stage:'Nuove richieste'};fail(store,phase,()=>store.createCase(input));assert.deepEqual(store.snapshot(),before);assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);assert.equal(store.createCase(input).duplicate,false);});
 test(`${phase}: failed case update restores held reference and removes nondurable new properties`,t=>{const store=fixture(t),{item}=store.createCase({id:'synthetic-case',stage:'Nuove richieste',request:{service:'rental'}}),before=store.snapshot();fail(store,phase,()=>store.updateCase(item.id,{stage:'Completata',new_field:'not durable',request:{service:'changed'}}));assert.deepEqual(store.snapshot(),before);assert.equal(item.stage,'Nuove richieste');assert.equal(item.new_field,undefined);assert.deepEqual(new JsonStateStore(store.filePath).snapshot(),before);});
}
test('failed audit compaction preserves bounded history and does not persist its failed event on a later save',t=>{const store=fixture(t);store.state.events=Array.from({length:2000},(_,i)=>({id:String(i),type:'SYNTHETIC_HISTORY'}));store.save();const before=store.snapshot();fail(store,'renameSync',()=>store.audit('FAILED_EVENT'));assert.deepEqual(store.snapshot(),before);store.setCursor('synthetic',1);assert.equal(new JsonStateStore(store.filePath).state.events.some(e=>e.type==='FAILED_EVENT'),false);assert.equal(store.state.events[0].id,'0');});
test('case creation and audit use one save; duplicate lookup and unknown update have no mutation',t=>{const store=fixture(t),save=store.save;let writes=0;store.save=function(){writes++;return save.call(this);};const {item}=store.createCase({id:'synthetic-case',stage:'Nuove richieste'});assert.equal(writes,1);assert.equal(store.state.events.filter(e=>e.type==='CASE_CREATED'&&e.case_id===item.id).length,1);const before=store.snapshot();assert.equal(store.createCase({id:item.id,stage:'Completata'}).duplicate,true);assert.throws(()=>store.updateCase('unknown',{}));assert.equal(writes,1);assert.deepEqual(store.snapshot(),before);});
test('runtime mail/thread modules: failed post-effect audit never permits an automatic replay',async t=>{
 const store=fixture(t);let writes=0;const real=fs.renameSync;let failAudit=false;
 const parsed={messageId:'<synthetic@example.invalid>',subject:'Synthetic',text:'No real message'};
 const operation=()=>runMailOperation({store,account:'hello',validity:1,uid:1,parsed,execute:()=>linkThreadMessage({store,parsed,direction:'incoming',match:{lead:{id:9001},order_ids:[]},call:async(model,method)=>{if(method==='search_read')return [];if(method==='search_count')return 0;assert.equal(method,'message_post');writes++;failAudit=true;return 1;}})});
 fs.renameSync=(...args)=>{if(failAudit&&String(args[0]).startsWith(store.filePath))throw Error('Synthetic post-effect audit failure');return real(...args);};
 try{await assert.rejects(operation(),/Synthetic post-effect audit failure/);}finally{fs.renameSync=real;}
 assert.equal(writes,1);assert.equal(store.state.events.some(e=>e.type==='EMAIL_THREAD_LINKED'),false);const reopened=new JsonStateStore(store.filePath);assert.equal(Object.values(reopened.state.mail_operations)[0].status,'STARTED');
 const retry=await operation();assert.equal(retry.suspended,true);assert.equal(writes,1);assert.equal(Object.values(store.state.mail_operations)[0].status,'STARTED');
});
