import test from 'node:test';import assert from 'node:assert/strict';import {once} from 'node:events';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {ImapFlow} from 'imapflow';
test('actual listing route bounds search, preserves state and cleans readonly lock/logout on failure',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'listing-http-'));
 Object.assign(process.env,{APP_ENV:'test',PORT:'0',STATE_FILE:path.join(dir,'state.json'),API_TOKEN:'synthetic-listing-token',READ_ONLY:'true',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',HELLO_EMAIL:'synthetic@example.invalid',HELLO_PASSWORD:'synthetic-only'});
 const names=['connect','logout','getMailboxLock','search','fetchOne'],original=Object.fromEntries(names.map(n=>[n,ImapFlow.prototype[n]]));let connects=0,releases=0,logouts=0,mode='valid';
 ImapFlow.prototype.connect=async function(){connects++;};ImapFlow.prototype.logout=async()=>{logouts++;};
 ImapFlow.prototype.getMailboxLock=async function(folder,options){assert.equal(folder,'INBOX');assert.equal(options.readOnly,true);this.mailbox={exists:mode==='changed'?449:450,uidNext:450001,uidValidity:1n};return {release(){releases++;}};};
 ImapFlow.prototype.search=async(q,o)=>{assert.deepEqual(o,{uid:true});const [a,b]=q.seq.split(':').map(Number);assert.equal(b-a,199);if(mode==='failure')return false;return Array.from({length:200},(_,i)=>(a+i)*1000);};
 ImapFlow.prototype.fetchOne=async(uid,q,o)=>{assert.equal(o.uid,true);assert.equal(q.source,undefined);return {uid,seq:uid/1000,size:0,envelope:{subject:'Synthetic listing'},flags:new Set()};};
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');t.after(async()=>{for(const n of names)ImapFlow.prototype[n]=original[n];await new Promise(resolve=>app.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 const before=app.store.snapshot(),base='http://127.0.0.1:'+app.server.address().port,headers={authorization:'Bearer synthetic-listing-token'};
 let r=await fetch(base+'/v1/hello/messages?limit=20',{headers});assert.equal(r.status,200);let body=await r.json();assert.equal(body.messages.length,20);assert.equal(body.messages[0].uid,450000);assert.equal(body.partial,true);assert.equal(body.has_more,true);assert.equal(r.headers.get('cache-control'),'no-store');const cursor=body.next_cursor;assert.equal(typeof cursor,'string');
 r=await fetch(base+'/v1/hello/messages?limit=20&cursor='+encodeURIComponent(cursor),{headers});assert.equal(r.status,200);body=await r.json();assert.equal(body.messages[0].uid,430000);
 r=await fetch(base+'/v1/hello/messages?limit=19&cursor='+encodeURIComponent(cursor),{headers});assert.equal(r.status,400);assert.equal(connects,2);
 mode='changed';r=await fetch(base+'/v1/hello/messages?limit=20&cursor='+encodeURIComponent(cursor),{headers});assert.equal(r.status,409);assert.equal((await r.json()).code,'mail_cursor_snapshot_changed');
 mode='failure';r=await fetch(base+'/v1/hello/messages?limit=20',{headers});assert.equal(r.status,502);assert.equal((await r.json()).code,'mail_listing_search_invalid');
 r=await fetch(base+'/v1/hello/messages?since=not-a-date',{headers});assert.equal(r.status,400);assert.equal(connects,4);assert.equal(releases,4);assert.equal(logouts,4);assert.deepEqual(app.store.snapshot(),before);
});
