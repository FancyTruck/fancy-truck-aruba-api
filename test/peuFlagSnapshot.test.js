import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openMailDb} from '../src/peuMailDb.js';
import {ArubaService} from '../src/peuMailService.js';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flag-snapshot-')),db=openMailDb(path.join(dir,'mail.sqlite'));t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 for(let uid=1;uid<=401;uid++)db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,0)').run('pietro','INBOX','fixture',uid,'synthetic','synthetic','{}','["old"]');db.prepare('INSERT INTO mail_cursors VALUES(?,?,?,?)').run('pietro','INBOX','fixture',401);
 let mode='ok',locks=0,releases=0,batches=0;
 const client={mailbox:{uidValidity:'fixture'},list:async()=>[{path:'INBOX'}],async getMailboxLock(_,o){assert.deepEqual(o,{readOnly:true});locks++;return {release(){releases++;}};},async search(q){return q.all?Array.from({length:400},(_,i)=>i+1):[];},async *fetch(range){batches++;const ids=range.split(',').map(Number);assert(ids.length<=200);for(const uid of ids){if(uid===201&&mode==='throw')throw Error('synthetic IMAP interruption');if(uid===201&&mode==='omit')continue;yield {uid:uid===201&&mode==='wrong'?999:uid,flags:new Set(['new'])};}}};
 const service=new ArubaService({db,accounts:['pietro'],withImap:async(_,fn)=>fn(client),parse:()=>assert.fail('no new message parse')});
 return {db,run:()=>service.sync('pietro','INBOX'),set mode(v){mode=v;},snapshot:()=>db.prepare('SELECT uid,flags,deleted FROM mail_messages ORDER BY uid').all(),get counts(){return {locks,releases,batches};}};
}
for(const [mode,code] of [['omit','mail_flags_incomplete'],['wrong','message_flag_uid_mismatch']])test(`actual sync refuses ${mode} flag response without changing cached flags/deletion; retry succeeds`,async t=>{
 const f=fixture(t),before=f.snapshot();f.mode=mode;await assert.rejects(f.run(),{code});assert.deepEqual(f.snapshot(),before);assert.equal(f.db.prepare('SELECT last_uid FROM mail_cursors').get().last_uid,401);assert.equal(f.db.prepare('SELECT count(*) n FROM sqlite_temp_master').get().n,0);
 f.mode='ok';await f.run();assert.equal(f.db.prepare('SELECT count(*) n FROM mail_messages WHERE deleted=0 AND flags=?').get('["new"]').n,400);assert.equal(f.db.prepare('SELECT deleted FROM mail_messages WHERE uid=401').get().deleted,1);assert.equal(f.counts.locks,f.counts.releases);
});
test('IMAP interruption after first flag batch leaves all cached flags unchanged and removes temporary staging',async t=>{
 const f=fixture(t),before=f.snapshot();f.mode='throw';await assert.rejects(f.run(),/interruption/);assert.deepEqual(f.snapshot(),before);assert.equal(f.db.prepare('SELECT count(*) n FROM sqlite_temp_master').get().n,0);assert.equal(f.counts.locks,f.counts.releases);
});
test('final cache transaction failure rolls back every flag/deletion and cleans staging',async t=>{
 const f=fixture(t),before=f.snapshot();f.db.exec("CREATE TRIGGER deny_flags BEFORE UPDATE OF flags ON mail_messages WHEN NEW.uid=201 BEGIN SELECT RAISE(ABORT,'synthetic commit failure');END");await assert.rejects(f.run(),/commit failure/);assert.deepEqual(f.snapshot(),before);assert.equal(f.db.prepare('SELECT count(*) n FROM sqlite_temp_master').get().n,0);
});
test('complete multi-batch snapshot updates present rows, marks absent row and leaves cursor unchanged',async t=>{
 const f=fixture(t),result=await f.run();assert.equal(result.cursor.uid,401);assert.equal(result.new_messages,0);assert.equal(f.counts.batches,2);assert.equal(f.db.prepare('SELECT count(*) n FROM mail_messages WHERE deleted=0 AND flags=?').get('["new"]').n,400);assert.equal(f.db.prepare('SELECT deleted FROM mail_messages WHERE uid=401').get().deleted,1);assert.equal(f.db.prepare('SELECT count(*) n FROM sqlite_temp_master').get().n,0);
});
