import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openMailDb} from '../src/peuMailDb.js';
import {ArubaService} from '../src/peuMailService.js';

// Sparse UIDs deliberately make UID-number windows impractical. Sequence search
// bounds the response by messages, without ESEARCH or provider-specific features.
function fixture(t,count=401){
 const dir=mkdtempSync(join(tmpdir(),'flag-search-')),db=openMailDb(join(dir,'mail.sqlite'));
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const uids=Array.from({length:count},(_,i)=>1+i*1000000),last=uids.at(-1)||900000001;
 const insert=db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,0)');
 for(const uid of [...uids,999999])insert.run('pietro','INBOX','fixture',uid,'synthetic','synthetic','{}','["old"]');
 insert.run('pietro','INBOX','other',2,'synthetic','synthetic','{}','["old"]');
 db.prepare('INSERT INTO mail_cursors VALUES(?,?,?,?)').run('pietro','INBOX','fixture',last);
 let mode='ok',searches=0,fetches=0,locks=0,releases=0;
 const ranges=[];
 const client={mailbox:{uidValidity:'fixture',exists:count,uidNext:last+1},list:async()=>[{path:'INBOX'}],async getMailboxLock(_,options){assert.deepEqual(options,{readOnly:true});locks++;return {release(){releases++;}};},
  async search(q,options){
   assert.deepEqual(options,{uid:true});if(q.uid)return [];
   assert.deepEqual(Object.keys(q),['seq'],'flag search must never request all UIDs');
   const [start,end]=q.seq.split(':').map(Number);assert(start>=1&&end<=count&&end-start<200);ranges.push([start,end]);searches++;
   if(start===201&&mode==='throw')throw Error('synthetic search interruption');
   if(start===201&&mode==='false')return false;
   const ids=uids.slice(start-1,end);
   if(start===201&&mode==='omit')ids.pop();
   if(start===201&&mode==='repeat')ids[0]=uids[0];
   if(start===201&&mode==='future')ids[0]=client.mailbox.uidNext;
   return ids.reverse(); // IMAP SEARCH ordering need not be trusted.
  },
  async *fetch(range,query,options){
   assert.deepEqual(query,{uid:true,flags:true});assert.deepEqual(options,{uid:true});fetches++;
   const ids=range.split(',').map(Number);assert(ids.length<=200);
   for(const uid of ids)yield {uid,flags:new Set(['new'])};
   if(fetches===2&&mode==='exists')client.mailbox.exists--;
   if(fetches===2&&mode==='uidNext')client.mailbox.uidNext++;
   if(fetches===2&&mode==='validity')client.mailbox.uidValidity='changed';
  }
 };
 const service=new ArubaService({db,accounts:['pietro'],withImap:async(_,fn)=>fn(client),parse:()=>assert.fail('no new message parse')});
 return {db,client,uids,ranges,run:()=>service.sync('pietro','INBOX'),set mode(v){mode=v;},snapshot:()=>db.prepare('SELECT * FROM mail_messages ORDER BY validity,uid').all(),get counts(){return {searches,fetches,locks,releases};}};
}
function cleaned(f){assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_temp_master WHERE name LIKE 'flag_snapshot_%'").get().n,0);assert.equal(f.counts.locks,f.counts.releases);}
test('actual sync bounds each flag UID search by 200 sequence positions even with sparse UIDs',async t=>{
 const f=fixture(t),cursor=f.db.prepare('SELECT * FROM mail_cursors').get();const result=await f.run();
 assert.equal(result.new_messages,0);assert.equal(f.counts.searches,3);assert.equal(f.counts.fetches,3);assert.deepEqual(f.ranges,[[1,200],[201,400],[401,401]]);
 assert.equal(f.db.prepare("SELECT count(*) n FROM mail_messages WHERE validity='fixture' AND flags='[\"new\"]' AND deleted=0").get().n,401);
 assert.equal(f.db.prepare("SELECT deleted FROM mail_messages WHERE uid=999999").get().deleted,1);
 assert.equal(f.db.prepare("SELECT flags FROM mail_messages WHERE validity='other'").get().flags,'["old"]');
 assert.deepEqual(f.db.prepare('SELECT * FROM mail_cursors').get(),cursor);cleaned(f);
});
for(const [mode,code] of [['false','mail_flags_search_unavailable'],['omit','mail_flags_incomplete'],['repeat','message_flag_uid_mismatch'],['future','message_flag_uid_mismatch'],['throw',undefined]])test(`flag search ${mode} after first stage preserves all cached flags/deletions and releases lock`,async t=>{
 const f=fixture(t),before=f.snapshot();f.mode=mode;
 if(code)await assert.rejects(f.run(),{code});else await assert.rejects(f.run(),/synthetic search interruption/);
 assert.deepEqual(f.snapshot(),before);cleaned(f);f.mode='ok';await f.run();cleaned(f);
});
for(const field of ['exists','uidNext','validity'])test(`changed mailbox ${field} refuses snapshot publication`,async t=>{
 const f=fixture(t),before=f.snapshot();f.mode=field;await assert.rejects(f.run(),{code:'mailbox_changed_retry',status:409});assert.deepEqual(f.snapshot(),before);cleaned(f);
});
test('unknown or invalid mailbox count/UIDNEXT refuses flags search before deleting cache',async t=>{
 for(const [field,value] of [['exists',undefined],['exists',-1],['exists',1.5],['uidNext',undefined],['uidNext',0],['uidNext',Infinity]]){
  const f=fixture(t),before=f.snapshot();f.client.mailbox[field]=value;await assert.rejects(f.run(),{code:'mailbox_metadata_unavailable',status:502});assert.equal(f.counts.searches,0);assert.deepEqual(f.snapshot(),before);cleaned(f);
 }
});
test('confirmed empty mailbox marks cached messages absent without searching reversed ranges',async t=>{
 const f=fixture(t,0);const r=await f.run();assert.equal(r.new_messages,0);assert.equal(f.counts.searches,0);assert.equal(f.counts.fetches,0);assert.equal(f.db.prepare("SELECT deleted FROM mail_messages WHERE uid=999999").get().deleted,1);cleaned(f);
});
test('actual sync never treats failed IMAP SEARCH as a confirmed empty mailbox',async t=>{
 const f=fixture(t),before=f.snapshot();f.client.search=async q=>q.uid?[]:false;
 let failure;try{await f.run();}catch(error){failure=error;}
 assert.deepEqual(f.snapshot(),before,'failed SEARCH must not mark the whole cached mailbox deleted');assert.equal(failure?.code,'mail_flags_search_unavailable');assert.equal(failure?.status,502);cleaned(f);
});
