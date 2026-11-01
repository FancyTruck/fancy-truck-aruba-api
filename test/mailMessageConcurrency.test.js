import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ImapFlow} from 'imapflow';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('actual HTTP MIME admission prevents overlap, including client abort while work is pending',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mime-concurrency-'));
 Object.assign(process.env,{APP_ENV:'test',READ_ONLY:'true',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',STATE_FILE:path.join(dir,'state.json'),PORT:'0',API_TOKEN:'synthetic',HELLO_EMAIL:'synthetic@example.invalid',HELLO_PASSWORD:'synthetic'});
 const names=['connect','logout','getMailboxLock','fetchOne'],original=Object.fromEntries(names.map(n=>[n,ImapFlow.prototype[n]]));
 let connects=0,mode='valid',entered=deferred(),gate=deferred(),blocked=false;
 ImapFlow.prototype.connect=async function(){connects++;};ImapFlow.prototype.logout=async function(){};ImapFlow.prototype.getMailboxLock=async function(){return {release(){}};};
 const mime=Buffer.from('From: synthetic@example.invalid\r\nSubject: Synthetic\r\n\r\nSynthetic');
 ImapFlow.prototype.fetchOne=async function(_,q){if(q.size)return {size:mime.length};if(mode==='error')throw Error('Synthetic read error');if(blocked){blocked=false;entered.resolve();await gate.promise;}return {source:mime};};
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');
 t.after(async()=>{gate.resolve();for(const n of names)ImapFlow.prototype[n]=original[n];await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${app.server.address().port}/v1/hello/messages/1`,get=signal=>fetch(url,{headers:{authorization:'Bearer synthetic'},signal});
 const busy=async()=>{const before=connects,r=await get();assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'1');assert.equal((await r.json()).code,'MAIL_READ_BUSY');assert.equal(connects,before);};
 blocked=true;const first=get();await entered.promise;
 try{await busy();}finally{gate.resolve();await first;}
 assert.equal((await get()).status,200);
 entered=deferred();gate=deferred();blocked=true;const controller=new AbortController();const abandoned=get(controller.signal);await entered.promise;controller.abort();await assert.rejects(abandoned,e=>e.name==='AbortError');
 await busy();gate.resolve();
 // Wait on a known owner-operation barrier, not a fixed timing assumption.
 let completed=false;for(let i=0;i<100;i++){const r=await get();if(r.status===200){completed=true;break;}assert.equal(r.status,429);await new Promise(r=>setTimeout(r,5));}assert.equal(completed,true);
 mode='error';assert.equal((await get()).status,502);mode='valid';assert.equal((await get()).status,200);
 assert.equal(Object.keys(app.store.state.cursors).length,0);
});
