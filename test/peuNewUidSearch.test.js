import test from 'node:test';import assert from 'node:assert/strict';
import {readFolder} from '../src/peuMailSync.js';
import {ArubaService} from '../src/peuMailService.js';import {openMailDb} from '../src/peuMailDb.js';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
function fixture(count=1200){
 const ids=Array.from({length:count},(_,i)=>i*1000000+1);let mode='ok',searches=0,probes=0,downloads=0,releases=0;
 const c={mailbox:{uidValidity:'fixture',exists:count,uidNext:(ids.at(-1)||0)+1},list:async()=>[{path:'INBOX'}],getMailboxLock:async(_,o)=>{assert.deepEqual(o,{readOnly:true});return {release(){releases++;}};},
 async search(q,o){assert.deepEqual(o,{uid:true});assert.deepEqual(Object.keys(q),['seq'],'no mailbox-wide UID search');searches++;const [a,b]=q.seq.split(':').map(Number);assert(a>=1&&b<=count&&b-a<=100);if(mode==='false')return false;const rows=ids.slice(a-1,b);if(mode==='omit')rows.pop();if(mode==='duplicate')rows[rows.length-1]=rows[0];return rows.reverse();},
 async fetchOne(uid,q,o){
  if(q.uid&&!q.source&&!q.envelope){probes++;assert.equal(o.uid,false);assert.deepEqual(q,{uid:true});if(mode==='probe')return false;return {seq:uid,uid:ids[uid-1]};}
  assert.equal(o.uid,true);assert(ids.includes(uid));if(q.size)return {size:3};downloads++;if(mode==='changed')c.mailbox.exists--;return {uid,flags:new Set(),source:Buffer.from('abc')};
 },async *fetch(range){for(const uid of range.split(',').map(Number))yield {uid,flags:new Set()};}};
 return {c,ids,set mode(v){mode=v;},get counts(){return {searches,probes,downloads,releases};}};
}
test('bounded new UID page locates sparse cursor by <=32 metadata probes and <=101 search results',async()=>{
 const f=fixture(),cursor={validity:'fixture',uid:f.ids[899]},r=await readFolder(f.c,'INBOX',cursor,2);
 assert.deepEqual(r.items.map(x=>x.uid),f.ids.slice(900,902));assert.equal(r.hasMore,true);assert.equal(r.cursor.uid,f.ids[901]);assert.deepEqual(cursor,{validity:'fixture',uid:f.ids[899]});assert.equal(f.counts.searches,1);assert(f.counts.probes<=32);assert.equal(f.counts.downloads,2);assert.equal(f.counts.releases,1);
});
test('first page remains bounded and final page does not falsely report remaining mail',async()=>{
 const f=fixture();const first=await readFolder(f.c,'INBOX',null,100);assert.equal(first.items.length,100);assert.equal(first.hasMore,true);
 const last=await readFolder(f.c,'INBOX',{validity:'fixture',uid:f.ids[1198]},100);assert.deepEqual(last.items.map(x=>x.uid),[f.ids[1199]]);assert.equal(last.hasMore,false);
});
test('caught-up and empty mailbox avoid N:* reversal without SEARCH or source fetch',async()=>{
 for(const count of [0,1200]){const f=fixture(count),uid=f.ids.at(-1)||0,r=await readFolder(f.c,'INBOX',{validity:'fixture',uid},1);assert.deepEqual(r.items,[]);assert.equal(r.hasMore,false);assert.equal(f.counts.searches,0);assert.equal(f.counts.downloads,0);assert.equal(r.cursor.uid,uid);}
});
for(const [mode,code] of [['false','mail_uid_search_unavailable'],['omit','mail_uid_search_incomplete'],['duplicate','message_uid_mismatch'],['probe','message_uid_probe_unavailable'],['changed','mailbox_changed_retry']])test(`new UID ${mode} failure preserves caller cursor and releases readonly lock`,async()=>{
 const f=fixture(),cursor={validity:'fixture',uid:f.ids[899]};f.mode=mode;await assert.rejects(readFolder(f.c,'INBOX',cursor,1),{code});assert.equal(cursor.uid,f.ids[899]);assert.equal(f.counts.releases,1);
});
test('unknown mailbox metadata and invalid page limits fail before searching/downloading',async()=>{
 const f=fixture();f.c.mailbox.exists=undefined;await assert.rejects(readFolder(f.c,'INBOX',null,1),{code:'mailbox_metadata_unavailable'});assert.equal(f.counts.searches,0);
 for(const limit of [0,-1,1.5,101])await assert.rejects(readFolder(f.c,'INBOX',null,limit),{code:'invalid_mail_page_limit'});
});
test('actual sync imports all sparse UIDs without gaps and caught-up replay downloads nothing',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'new-uids-')),db=openMailDb(join(dir,'mail.sqlite'));t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});const f=fixture(203);
 // The final flag snapshot has its own <=200-position windows.
 const original=f.c.search;f.c.search=async(q,o)=>{const [a,b]=q.seq.split(':').map(Number);if(b-a===199)return f.ids.slice(a-1,b);return original(q,o);};
 const service=new ArubaService({db,accounts:['pietro'],withImap:async(_,fn)=>fn(f.c),parse:async()=>({text:'synthetic'})});
 const r=await service.sync('pietro','INBOX');assert.equal(r.new_messages,203);assert.equal(r.cursor.uid,f.ids.at(-1));assert.equal(db.prepare('SELECT count(*) n FROM mail_messages WHERE deleted=0').get().n,203);const downloads=f.counts.downloads;
 assert.equal((await service.sync('pietro','INBOX')).new_messages,0);assert.equal(f.counts.downloads,downloads);
});
