import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ImapFlow} from 'imapflow';
import {openMailDb} from '../src/peuMailDb.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('actual Peu attachment and message HTTP routes share admission through abort, completion and errors',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'attachment-admission-')),file=path.join(directory,'state.json');
 const db=openMailDb(path.join(directory,'peu-aruba.sqlite'));
 db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,0)').run('pietro','INBOX','fixture',1,'fixture','fixture','{}','[]');db.close();
 Object.assign(process.env,{APP_ENV:'test',STATE_FILE:file,READ_ONLY:'true',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',PORT:'0',API_TOKEN:'fixture-admin',PEU_ACCESS_TOKEN:'fixture-peu',PIETRO_EMAIL:'fixture@example.invalid',PIETRO_PASSWORD:'synthetic'});
 const names=['connect','logout','getMailboxLock','fetchOne'],original=Object.fromEntries(names.map(n=>[n,ImapFlow.prototype[n]]));
 let connects=0,logouts=0,locks=0,releases=0,blocked=false,fail=false,entered=deferred(),gate=deferred();
 const mime=Buffer.from('From: fixture@example.invalid\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="x"\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nSynthetic\r\n--x\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="fixture.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nZml4dHVyZQ==\r\n--x--\r\n');
 ImapFlow.prototype.connect=async()=>{connects++;};ImapFlow.prototype.logout=async()=>{logouts++;};
 ImapFlow.prototype.getMailboxLock=async function(){locks++;this.mailbox={uidValidity:'fixture'};return {release(){releases++;}};};
 ImapFlow.prototype.fetchOne=async function(_,q){if(q.size)return {size:mime.length};assert.equal(q.source.maxLength,20*1024*1024+1);if(blocked){blocked=false;entered.resolve();await gate.promise;}if(fail)throw Error('Synthetic source failure');return {source:mime};};
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');
 t.after(async()=>{gate.resolve();for(const n of names)ImapFlow.prototype[n]=original[n];await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const get=(route,signal)=>fetch(base+(route==='attachment'?'/v1/peu/aruba/pietro/attachment?folder=INBOX&validity=fixture&uid=1&index=0':'/v1/pietro/messages/1'),{headers:{authorization:'Bearer '+(route==='attachment'?'fixture-peu':'fixture-admin')},signal});
 const busy=async route=>{const before=connects,r=await get(route);assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'1');const data=await r.json();assert(data.code==='MAIL_READ_BUSY'||data.error==='mail_read_busy');assert.equal(connects,before);};
 for(const owner of ['attachment','message']){
  entered=deferred();gate=deferred();blocked=true;const first=get(owner);await entered.promise;
  try{await busy('attachment');await busy('message');}finally{gate.resolve();const response=await first;assert.equal(response.status,200);await response.arrayBuffer();}
 }
 entered=deferred();gate=deferred();blocked=true;const controller=new AbortController(),first=get('attachment',controller.signal);await entered.promise;controller.abort();await assert.rejects(first,e=>e.name==='AbortError');
 try{await busy('message');await busy('attachment');}finally{gate.resolve();}
 let released=false;for(let i=0;i<100;i++){const r=await get('attachment');if(r.status===200){assert.equal(Buffer.from((await r.json()).content,'base64').toString(),'fixture');released=true;break;}assert.equal(r.status,429);await new Promise(r=>setTimeout(r,5));}assert(released);
 fail=true;assert.equal((await get('attachment')).status,502);fail=false;assert.equal((await get('message')).status,200);
 assert.equal(connects,logouts);assert.equal(locks,releases);assert.deepEqual(app.store.state.cursors,{});
});
