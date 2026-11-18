import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ArubaService} from '../src/peuMailService.js';
import {openMailDb} from '../src/peuMailDb.js';
for(const fault of ['duplicate_metadata','foreign_metadata','duplicate_source','foreign_source'])test(`reconciled batch ${fault} preserves durable cursor and cache before parsing`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'batch-reconcile-')),db=openMailDb(join(dir,'mail.sqlite'));
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 db.prepare('INSERT INTO mail_cursors VALUES(?,?,?,?)').run('hello','INBOX','1',9);
 let parses=0,released=false;
 const client={mailbox:{uidValidity:1,exists:2,uidNext:12},list:async()=>[{path:'INBOX'}],getMailboxLock:async()=>({release(){released=true;}}),search:async()=>[10,11],async *fetch(_range,q){
  const metadata=q.size;
  const ids=fault===(metadata?'duplicate_metadata':'duplicate_source')?[10,10,11]:fault===(metadata?'foreign_metadata':'foreign_source')?[10,12]:[10,11];
  for(const uid of ids)yield metadata?{uid,size:3,envelope:{},flags:new Set()}:{uid,source:Buffer.from('abc')};
 }};
 const service=new ArubaService({db,accounts:['hello'],withImap:async(_,fn)=>fn(client),parse:async()=>{parses++;return {};}});
 await assert.rejects(service.sync('hello','INBOX'),{code:'message_uid_mismatch'});
 assert.equal(parses,0);assert.equal(db.prepare('SELECT last_uid FROM mail_cursors').get().last_uid,9);
 assert.equal(db.prepare('SELECT count(*) n FROM mail_messages').get().n,0);assert.equal(released,true);
});
