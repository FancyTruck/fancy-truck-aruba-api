import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ArubaService} from '../src/peuMailService.js';
import {readFolder} from '../src/peuMailSync.js';
function fixture(payload){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mail_messages(account,folder,validity,uid,message_id,thread_key,payload,flags,deleted)');db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,?)').run('pietro','INBOX','1',1,'m','thread',JSON.stringify(payload),'[]',0);return {db,service:new ArubaService({db,accounts:['pietro']})};}
test('legacy attachment bodies never cross the SQLite to JS boundary',()=>{
 const {db,service}=fixture({subject:'test',text:'x'.repeat(25000),from:[{address:'a@example.test'}],to:[],references:['m'],attachments:[{filename:'large.bin',contentType:'application/octet-stream',size:2e6,content:'x'.repeat(2e6)}]});
 try {for(const rows of [service.messages('pietro','INBOX'),service.thread('pietro','thread').messages]){assert.equal(rows[0].payload.attachments[0].filename,'large.bin');assert.equal(rows[0].payload.attachments[0].content,undefined);assert.equal(rows[0].payload.text.length,20000);assert.ok(rows[0].payload.text_truncated);assert.ok(JSON.stringify(rows).length<22000);}}finally{db.close();}
});
test('oversized legacy rows return explicit incomplete coverage and remain stored',()=>{
 const {db,service}=fixture({text:'preserve',attachments:[{content:'x'.repeat(17*1024*1024)}]});
 try{assert.equal(service.messages('pietro','INBOX')[0].payload.content_status,'requires_large_message_download');assert.ok(db.prepare('SELECT length(payload) n FROM mail_messages').get().n>16777216);}finally{db.close();}
});
test('large IMAP message with missing envelope stops without downloading or advancing the caller cursor',async()=>{
 let released=false,downloads=0;const cursor={validity:'1',uid:9};
 const client={mailbox:{uidValidity:1},getMailboxLock:async()=>({release(){released=true;}}),search:async()=>[10],fetchOne:async(_id,q)=>{if(q.source)downloads++;return {size:21*1024*1024};}};
 await assert.rejects(readFolder(client,'INBOX',cursor,1),{code:'message_metadata_unavailable'});assert.equal(downloads,0);assert.equal(cursor.uid,9);assert.ok(released);
});
test('IMAP source is bounded even if reported size is incorrect',async()=>{
 let released=false;
 const client={mailbox:{uidValidity:1},getMailboxLock:async()=>({release(){released=true;}}),search:async()=>[1],fetchOne:async(_id,q)=>{if(!q.source)return {size:10};assert.equal(q.source.maxLength,20*1024*1024+1);return {source:Buffer.alloc(q.source.maxLength)};}};
 await assert.rejects(readFolder(client,'INBOX',null,1),{code:'mail_sync_large_message_requires_review'});assert.ok(released);
});
test('small mail remains readable with its normal cursor',async()=>{
 const client={mailbox:{uidValidity:1},getMailboxLock:async()=>({release(){}}),search:async()=>[1],fetchOne:async(_id,q)=>q.source?{uid:1,source:Buffer.from('hello'),flags:new Set() }:{size:5}};
 const r=await readFolder(client,'INBOX',null,1);assert.equal(r.cursor.uid,1);assert.equal(Buffer.from(r.items[0].source,'base64').toString(),'hello');
});

test('batch memory budget paginates without skipping messages',async()=>{
 let downloads=0;const client={mailbox:{uidValidity:1},getMailboxLock:async()=>({release(){}}),search:async()=>[1,2],fetchOne:async(uid,q)=>{if(!q.source)return {size:11*1024*1024};downloads++;return {uid,source:Buffer.alloc(11*1024*1024),flags:new Set()};}};
 const r=await readFolder(client,'INBOX',null,100);assert.equal(downloads,1);assert.equal(r.items.length,1);assert.equal(r.cursor.uid,1);assert.equal(r.hasMore,true);
});
