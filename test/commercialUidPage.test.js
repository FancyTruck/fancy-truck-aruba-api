import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {pollMailbox} from '../src/mailPolling.js';import {JsonStateStore} from '../src/store.js';
function fixture(t,count=1200){
 const dir=mkdtempSync(join(tmpdir(),'commercial-uids-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=new JsonStateStore(join(dir,'state.json')),ids=Array.from({length:count},(_,i)=>1000000*i+1),processed=[],queries=[];
 store.setCursor('imap:hello:checkpoint',{uidValidity:'fixture',lastUid:ids[899],initialSince:'2026-11-01T00:00:00Z'});
 const args={store,account:'hello',parse:async()=>({text:'synthetic'}),processMessage:async(_,uid)=>{processed.push(uid);return {};},client:{mailbox:{uidValidity:'fixture',exists:count,uidNext:ids.at(-1)+1},
 search:async(q,o)=>{queries.push(q);assert.deepEqual(o,{uid:true});assert.deepEqual(Object.keys(q),['seq']);const [a,b]=q.seq.split(':').map(Number);assert(b-a<=100);return ids.slice(a-1,b).reverse();},
 fetchOne:async(uid,q,o)=>{if(o.uid===false)return {seq:uid,uid:ids[uid-1]};return q.size?{size:3}:{source:Buffer.from('abc')};}}};
 return {args,ids,processed,queries,cursor:()=>store.cursor('imap:hello:checkpoint')};
}
test('commercial resume reads bounded sparse UID pages and reopens without gaps',async t=>{
 const f=fixture(t);for(let i=0;i<3;i++){await pollMailbox({...f.args,store:new JsonStateStore(f.args.store.filePath)});}
 assert.deepEqual(f.processed,f.ids.slice(900));assert.equal(new JsonStateStore(f.args.store.filePath).cursor('imap:hello:checkpoint').lastUid,f.ids.at(-1));assert.equal(f.queries.length,3);
});
test('caught-up commercial cursor avoids SEARCH and fetch',async t=>{
 const f=fixture(t);f.args.store.setCursor('imap:hello:checkpoint',{...f.cursor(),lastUid:f.ids.at(-1)});
 f.args.client.search=()=>assert.fail('caught-up SEARCH');f.args.client.fetchOne=()=>assert.fail('caught-up FETCH');assert.deepEqual(await pollMailbox(f.args),[]);
});
for(const mode of ['false','incomplete','duplicate','changed'])test(`commercial ${mode} discovery holds durable checkpoint before any processing`,async t=>{
 const f=fixture(t),prior=f.cursor(),search=f.args.client.search;
 f.args.client.search=async(q,o)=>{const ids=await search(q,o);if(mode==='false')return false;if(mode==='incomplete')return ids.slice(1);if(mode==='duplicate')ids[0]=ids[1];if(mode==='changed')f.args.client.mailbox.uidNext++;return ids;};
 await assert.rejects(pollMailbox(f.args));assert.deepEqual(new JsonStateStore(f.args.store.filePath).cursor('imap:hello:checkpoint'),prior);assert.deepEqual(f.processed,[]);
});
test('failed processing resumes same UID while preserving already committed work',async t=>{
 const f=fixture(t),process=f.args.processMessage;f.args.processMessage=async(m,uid)=>{if(uid===f.ids[901])throw Error('synthetic Odoo failure');return process(m,uid);};
 const rows=await pollMailbox(f.args);assert.equal(rows.at(-1).retry_pending,true);assert.equal(f.cursor().lastUid,f.ids[900]);
 await pollMailbox({...f.args,processMessage:process,store:new JsonStateStore(f.args.store.filePath)});assert.deepEqual(f.processed,f.ids.slice(900,1001));
});
test('unknown mailbox metadata refuses post-checkpoint discovery without unbounded fallback',async t=>{
 const f=fixture(t);delete f.args.client.mailbox.exists;await assert.rejects(pollMailbox(f.args));assert.equal(f.queries.length,0);assert.deepEqual(f.processed,[]);
});
test('observed mailbox change during source fetch stops before MIME and preserves cursor',async t=>{
 const f=fixture(t),prior=f.cursor(),fetch=f.args.client.fetchOne;
 f.args.client.fetchOne=async(uid,q,o)=>{const r=await fetch(uid,q,o);if(q.source)f.args.client.mailbox.exists++;return r;};
 f.args.parse=()=>assert.fail('changed mailbox must stop before MIME');
 const rows=await pollMailbox(f.args);assert.equal(rows[0].retry_pending,true);
 assert.deepEqual(new JsonStateStore(f.args.store.filePath).cursor('imap:hello:checkpoint'),prior);assert.deepEqual(f.processed,[]);
});
