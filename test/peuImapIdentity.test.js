import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readFolder} from '../src/peuMailSync.js';
import {ArubaService} from '../src/peuMailService.js';
import {openMailDb} from '../src/peuMailDb.js';
function fixture(){let returnedUid=10,size=7,downloads=0,releases=0,locks=0;
 const client={mailbox:{uidValidity:'fixture'},list:async()=>[{path:'INBOX'}],async getMailboxLock(_,options){assert.deepEqual(options,{readOnly:true});locks++;return {release(){releases++;}};},async search(query){return query.all?[9,10]:[10];},async fetchOne(uid,q){assert.equal(uid,10);if(q.size)return {size};downloads++;return {uid:returnedUid,source:Buffer.from('fixture'),flags:new Set()};},async *fetch(){for(const uid of [9,10])yield {uid,flags:new Set()};}};
 return {client,set uid(value){returnedUid=value;},set size(value){size=value;},get counts(){return {downloads,releases,locks};}};
}
test('normal source fetch must return the exact requested UID before exposing a batch/cursor',async()=>{
 for(const uid of [undefined,11,999,'10']){
  const f=fixture(),cursor={validity:'fixture',uid:9};f.uid=uid;
  await assert.rejects(readFolder(f.client,'INBOX',cursor,1),{code:'message_uid_mismatch',status:502});assert.deepEqual(cursor,{validity:'fixture',uid:9});assert.equal(f.counts.releases,1);
 }
});
test('negative declared size rejects before source download',async()=>{
 const f=fixture();f.size=-1;await assert.rejects(readFolder(f.client,'INBOX',{validity:'fixture',uid:9},1),{code:'message_size_unavailable',status:502});assert.equal(f.counts.downloads,0);assert.equal(f.counts.releases,1);
});
test('actual Aruba sync preserves durable cursor/cache and avoids parsing mismatched UID; corrected retry processes same UID',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'imap-identity-')),db=openMailDb(path.join(directory,'mail.sqlite'));t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
 db.prepare('INSERT INTO mail_cursors VALUES(?,?,?,?)').run('pietro','INBOX','fixture',9);db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,0)').run('pietro','INBOX','fixture',9,'synthetic','synthetic','{}','[]');
 const before=()=>({rows:db.prepare('SELECT * FROM mail_messages ORDER BY uid').all(),cursor:db.prepare('SELECT * FROM mail_cursors').all()});const prior=before(),f=fixture();f.uid=999;let parses=0;
 const service=new ArubaService({db,accounts:['pietro'],withImap:async(_,fn)=>fn(f.client),parse:async()=>{parses++;return {messageId:'fixture',text:'Synthetic'};}});
 await assert.rejects(service.sync('pietro','INBOX'),{code:'message_uid_mismatch'});assert.equal(parses,0);assert.deepEqual(before(),prior);
 f.uid=10;const result=await service.sync('pietro','INBOX');assert.equal(result.cursor.uid,10);assert.equal(parses,1);assert.equal(result.new_messages,1);assert.equal(db.prepare('SELECT last_uid FROM mail_cursors').get().last_uid,10);assert.equal(db.prepare('SELECT count(*) n FROM mail_messages').get().n,2);assert.equal(f.counts.releases,f.counts.locks);
});
