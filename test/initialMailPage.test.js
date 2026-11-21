import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {pollMailbox} from '../src/mailPolling.js';import {JsonStateStore} from '../src/store.js';
function fixture(t,count=350,qualifying=[2,150,280]){
 const dir=mkdtempSync(join(tmpdir(),'initial-mail-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=new JsonStateStore(join(dir,'state.json')),ids=Array.from({length:count},(_,i)=>i*1000+1),eligible=new Set(qualifying.map(i=>ids[i])),processed=[],queries=[];
 const client={mailbox:{uidValidity:'initial',exists:count,uidNext:(ids.at(-1)||0)+1},
 async search(q,o){queries.push(q);assert.deepEqual(o,{uid:true});assert(q.seq,'every bootstrap search must have a bounded sequence window');const [a,b]=q.seq.split(':').map(Number);assert(b-a<=100);let rows=ids.slice(a-1,b);if(q.uid){const [lo,hi]=q.uid.split(':').map(Number);rows=rows.filter(id=>id>=lo&&id<=hi);}if(q.since)rows=rows.filter(id=>eligible.has(id));return rows.reverse();},
 async fetchOne(uid,q,o){if(o.uid===false)return {seq:uid,uid:ids[uid-1]};return q.size?{size:3}:{source:Buffer.from('abc')};}};
 const args={client,store,account:'hello',now:Date.UTC(2026,10,21),parse:async()=>({text:'synthetic'}),processMessage:async(_,uid)=>{processed.push(uid);return {};}};
 return {args,ids,eligible,processed,queries,key:'imap:hello:checkpoint'};
}
test('initial date scan keeps out-of-order date-qualified messages across bounded pages and reopen',async t=>{
 const f=fixture(t);for(let i=0;i<4;i++)await pollMailbox({...f.args,store:new JsonStateStore(f.args.store.filePath)});
 assert.deepEqual(f.processed,[...f.eligible]);const cp=new JsonStateStore(f.args.store.filePath).cursor(f.key);assert.equal(cp.bootstrap_scan.complete,true);assert.equal(cp.bootstrap_scan.uid,f.ids.at(-1));assert.equal(cp.lastUid,f.ids[280]);
 const before=f.queries.length;await pollMailbox({...f.args,store:new JsonStateStore(f.args.store.filePath)});assert.equal(f.queries.length,before);assert.deepEqual(f.processed,[...f.eligible]);
});
test('date cutoff stays fixed after days; empty date windows progress without processing old mail',async t=>{
 const f=fixture(t,350,[280]);const first=await pollMailbox(f.args);assert.equal(first[0].reason,'mail_bootstrap_scan_pending');assert.deepEqual(f.processed,[]);
 await pollMailbox({...f.args,store:new JsonStateStore(f.args.store.filePath),now:f.args.now+7*86400000});
 const dates=f.queries.filter(q=>q.since).map(q=>+q.since);assert.equal(dates.length,2);assert.equal(dates[0],dates[1]);assert.equal(new JsonStateStore(f.args.store.filePath).cursor(f.key).lastUid,0);
});
test('more than100 matching initial messages are never skipped',async t=>{
 const f=fixture(t,250,Array.from({length:250},(_,i)=>i));for(let i=0;i<3;i++)await pollMailbox({...f.args,store:new JsonStateStore(f.args.store.filePath)});assert.deepEqual(f.processed,f.ids);
});
for(const mode of ['false','foreign','duplicate'])test(`malformed ${mode} date response holds bootstrap checkpoint before side effects`,async t=>{
 const f=fixture(t),search=f.args.client.search;f.args.client.search=async(q,o)=>{const ids=await search(q,o);return !q.since?ids:mode==='false'?false:mode==='foreign'?[999999999]:[ids[0],ids[0]];};
 await assert.rejects(pollMailbox(f.args));const cp=new JsonStateStore(f.args.store.filePath).cursor(f.key);assert.equal(cp.lastUid,0);assert.equal(cp.bootstrap_scan.uid,0);assert.deepEqual(f.processed,[]);
});
test('failed scan cursor persistence cannot skip date-qualified mail after retry',async t=>{
 const f=fixture(t,350,[280]),save=f.args.store.save;f.args.store.save=function(){if(this.state.cursors[f.key]?.bootstrap_scan?.uid>0)throw Error('synthetic scan disk failure');return save.call(this);};
 await assert.rejects(pollMailbox(f.args),/scan disk failure/);assert.equal(new JsonStateStore(f.args.store.filePath).cursor(f.key).bootstrap_scan.uid,0);
 f.args.store.save=save;for(let i=0;i<4;i++)await pollMailbox({...f.args,store:new JsonStateStore(f.args.store.filePath)});assert.deepEqual(f.processed,[...f.eligible]);
});
test('processing failure holds the exact eligible UID and retains earlier committed work',async t=>{
 const f=fixture(t,50,[2,20]),process=f.args.processMessage;f.args.processMessage=async(m,uid)=>{if(uid===f.ids[20])throw Error('synthetic Odoo failure');return process(m,uid);};const rows=await pollMailbox(f.args);assert.equal(rows.at(-1).retry_pending,true);
 await pollMailbox({...f.args,store:new JsonStateStore(f.args.store.filePath),processMessage:process});assert.deepEqual(f.processed,[...f.eligible]);
});
test('empty initial mailbox completes scan without SEARCH and still records no processed mail',async t=>{
 const f=fixture(t,0,[]);assert.deepEqual(await pollMailbox(f.args),[]);assert.equal(f.queries.length,0);assert.equal(f.args.store.cursor(f.key).bootstrap_scan.complete,true);assert.equal(f.args.store.cursor(f.key).lastUid,0);
});
test('bootstrap snapshot excludes later arrivals until date scan ends, then resumes them normally',async t=>{
 const f=fixture(t,350,[280]);await pollMailbox(f.args);
 const snapshot=f.args.store.cursor(f.key).bootstrap_scan.upper_uid,newUid=snapshot+1000;
 f.ids.push(newUid);f.args.client.mailbox.exists++;f.args.client.mailbox.uidNext=newUid+1;
 for(let i=0;i<3;i++)await pollMailbox({...f.args,store:new JsonStateStore(f.args.store.filePath)});
 assert.deepEqual(f.processed,[...f.eligible]);const cp=new JsonStateStore(f.args.store.filePath).cursor(f.key);assert.equal(cp.bootstrap_scan.upper_uid,snapshot);assert.equal(cp.bootstrap_scan.complete,true);
 await pollMailbox({...f.args,store:new JsonStateStore(f.args.store.filePath)});assert.deepEqual(f.processed,[...f.eligible,newUid]);
});
test('malformed stored bootstrap scan fails closed before SEARCH or processing',async t=>{
 const f=fixture(t);f.args.store.setCursor(f.key,{uidValidity:'initial',lastUid:0,initialSince:'2026-11-20T00:00:00Z',bootstrap_scan:{uid:10,upper_uid:9,complete:false}});
 await assert.rejects(pollMailbox(f.args),{code:'MAIL_BOOTSTRAP_INVALID'});assert.equal(f.queries.length,0);assert.deepEqual(f.processed,[]);
});
