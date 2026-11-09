import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ImapFlow} from 'imapflow';
import {ArubaService} from '../src/peuMailService.js';
import {openMailDb} from '../src/peuMailDb.js';
import {MAX_POLL_SOURCE_BYTES as limit} from '../src/mailPolling.js';

function fixture(size,source) {
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE mail_messages(account,folder,validity,uid,message_id,thread_key,payload,flags,deleted)');
 db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,0)').run('pietro','INBOX','fixture',1,'synthetic','synthetic','{}','[]');
 let downloads=0,parses=0,releases=0;
 const client={mailbox:{uidValidity:'fixture'},async getMailboxLock(folder,options){assert.equal(folder,'INBOX');assert.deepEqual(options,{readOnly:true});return {release(){releases++;}};},async fetchOne(uid,query,options){
  assert.equal(uid,1);assert.deepEqual(options,{uid:true});
  if(query.size)return {size};downloads++;
  assert.deepEqual(query.source,{start:0,maxLength:limit+1});return {source};
 }};
 const service=new ArubaService({db,accounts:['pietro'],withImap:async(_account,fn)=>fn(client),parse:async()=>{parses++;return {attachments:[{filename:'synthetic.txt',contentType:'text/plain',size:7,content:Buffer.from('fixture')}]};}});
 return {read:()=>service.attachment('pietro','INBOX','fixture',1,0),close:()=>db.close(),get counts(){return {downloads,parses,releases};}};
}
test('attachment rejects unknown or invalid declared size before source download',async()=>{
 for(const size of [undefined,null,NaN,Infinity,-1,0.5,'10',Number.MAX_SAFE_INTEGER+1]){
  const f=fixture(size,Buffer.from('synthetic'));
  try{await assert.rejects(f.read(),{code:'message_size_unavailable',status:502});assert.deepEqual(f.counts,{downloads:0,parses:0,releases:1});}finally{f.close();}
 }
});
test('attachment rejects known oversize before source download',async()=>{
 const f=fixture(limit+1,Buffer.from('synthetic'));
 try{await assert.rejects(f.read(),{code:'attachment_requires_large_message_download',status:413});assert.deepEqual(f.counts,{downloads:0,parses:0,releases:1});}finally{f.close();}
});
test('attachment checks returned source bytes before parsing despite small reported size',async()=>{
 for(const source of [Buffer.alloc(limit+1),'é'.repeat(Math.floor(limit/2)+1)]){
  const f=fixture(1,source);
  try{await assert.rejects(f.read(),{code:'attachment_requires_large_message_download',status:413});assert.deepEqual(f.counts,{downloads:1,parses:0,releases:1});}finally{f.close();}
 }
});
test('attachment accepts exact byte boundary and releases lock on parser success',async()=>{
 const f=fixture(limit,Buffer.alloc(limit));
 try{assert.equal(Buffer.from((await f.read()).content,'base64').toString(),'fixture');assert.deepEqual(f.counts,{downloads:1,parses:1,releases:1});}finally{f.close();}
});
test('actual attachment HTTP route rejects unknown size without download and recovers admission',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'attachment-boundaries-'));
 const db=openMailDb(path.join(directory,'peu-aruba.sqlite'));
 db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,0)').run('pietro','INBOX','fixture',1,'synthetic','synthetic','{}','[]');db.close();
 Object.assign(process.env,{APP_ENV:'test',STATE_FILE:path.join(directory,'state.json'),READ_ONLY:'true',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',PORT:'0',API_TOKEN:'fixture-admin',PEU_ACCESS_TOKEN:'fixture-peu',PIETRO_EMAIL:'fixture@example.invalid',PIETRO_PASSWORD:'synthetic'});
 const names=['connect','logout','getMailboxLock','fetchOne'],original=Object.fromEntries(names.map(n=>[n,ImapFlow.prototype[n]]));
 let size,downloads=0,connects=0,logouts=0,locks=0,releases=0;
 const mime=Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="x"\r\n\r\n--x\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="synthetic.txt"\r\n\r\nfixture\r\n--x--\r\n');
 ImapFlow.prototype.connect=async()=>{connects++;};ImapFlow.prototype.logout=async()=>{logouts++;};
 ImapFlow.prototype.getMailboxLock=async function(){locks++;this.mailbox={uidValidity:'fixture'};return {release(){releases++;}};};
 ImapFlow.prototype.fetchOne=async function(_,q){if(q.size)return {size};downloads++;assert.equal(q.source.maxLength,limit+1);return {source:mime};};
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');
 t.after(async()=>{for(const n of names)ImapFlow.prototype[n]=original[n];await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
 const get=()=>fetch('http://127.0.0.1:'+app.server.address().port+'/v1/peu/aruba/pietro/attachment?folder=INBOX&validity=fixture&uid=1&index=0',{headers:{authorization:'Bearer fixture-peu'}});
 for(size of [undefined,'10',-1]){
  const response=await get();assert.equal(response.status,502);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{error:'message_size_unavailable'});assert.equal(downloads,0);
 }
 size=mime.length;const response=await get();assert.equal(response.status,200);assert.equal(Buffer.from((await response.json()).content,'base64').toString(),'fixture');
 assert.equal(downloads,1);assert.equal(connects,logouts);assert.equal(locks,releases);assert.deepEqual(app.store.state.cursors,{});
});
