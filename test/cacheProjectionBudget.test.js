import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {openMailDb} from '../src/peuMailDb.js';
import {ArubaService} from '../src/peuMailService.js';
const budget=128*1024;
function seed(db,payload,count=1){for(let uid=1;uid<=count;uid++)db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,0)').run('pietro','INBOX','fixture',uid,'fixture','thread',JSON.stringify(payload),'[]');}
test('SQLite bounds projected metadata bytes before JSON.parse for message and thread reads',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mail_messages(account,folder,validity,uid,message_id,thread_key,payload,flags,deleted)');const service=new ArubaService({db,accounts:['pietro']});
 const large='é'.repeat(70000); // Fewer characters than the byte budget.
 for(const payload of [{references:[large]},{from:[{name:large}]},{to:[{address:large}]},{attachments:[{filename:large,contentType:'text/plain',size:1}]}]){
  db.exec('DELETE FROM mail_messages');seed(db,payload);
  const stored=db.prepare('SELECT payload FROM mail_messages').get().payload,parse=JSON.parse;let biggest=0;
  JSON.parse=value=>{biggest=Math.max(biggest,Buffer.byteLength(value));return parse(value);};
  try{for(const rows of [service.messages('pietro','INBOX'),service.thread('pietro','thread').messages]){assert.equal(rows[0].payload.content_status,'requires_bounded_metadata_review');assert.equal(rows[0].payload.metadata_truncated,true);}assert(biggest<=budget);}finally{JSON.parse=parse;}
  assert.equal(db.prepare('SELECT payload FROM mail_messages').get().payload,stored);
 }db.close();
});
test('normal projected metadata remains readable despite large excluded attachment body',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mail_messages(account,folder,validity,uid,message_id,thread_key,payload,flags,deleted)');seed(db,{subject:'Synthetic',text:'Readable',from:[{address:'fixture@example.invalid'}],references:['fixture'],attachments:[{filename:'fixture.txt',contentType:'text/plain',size:200000,content:'x'.repeat(200000)}]});
 try{const service=new ArubaService({db,accounts:['pietro']}),m=service.messages('pietro','INBOX')[0].payload;assert.equal(m.text,'Readable');assert.deepEqual(m.references,['fixture']);assert.equal(m.attachments[0].filename,'fixture.txt');assert.equal(m.attachments[0].content,undefined);assert.notEqual(m.content_status,'requires_bounded_metadata_review');}finally{db.close();}
});
test('actual readonly cached HTTP listings bound 100 projected rows and preserve source/cursor',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cache-budget-')),file=path.join(dir,'peu-aruba.sqlite'),db=openMailDb(file);seed(db,{references:['x'.repeat(200000)]},100);db.prepare('INSERT INTO mail_cursors VALUES(?,?,?,?)').run('pietro','INBOX','fixture',100);db.close();const bytes=fs.readFileSync(file);
 Object.assign(process.env,{APP_ENV:'test',STATE_FILE:path.join(dir,'state.json'),READ_ONLY:'true',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',PORT:'0',API_TOKEN:'fixture-admin',PEU_ACCESS_TOKEN:'fixture-peu',PIETRO_EMAIL:'fixture@example.invalid',PIETRO_PASSWORD:'synthetic'});
 const fetcher=globalThis.fetch;let providers=0;globalThis.fetch=async()=>{providers++;throw Error('No provider');};
 const app=await import('../src/server.js');if(!app.server.listening)await once(app.server,'listening');t.after(async()=>{globalThis.fetch=fetcher;await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 for(const suffix of ['messages?folder=INBOX','thread?thread=thread']){
  const response=await fetcher('http://127.0.0.1:'+app.server.address().port+'/v1/peu/aruba/pietro/'+suffix,{headers:{authorization:'Bearer fixture-peu'}});assert.equal(response.status,200);const text=await response.text();assert(Buffer.byteLength(text)<100*budget);const result=JSON.parse(text);assert.equal(result.messages.length,100);assert(result.messages.every(m=>m.payload.content_status==='requires_bounded_metadata_review'));
 }assert.equal(providers,0);assert.deepEqual(fs.readFileSync(file),bytes);
 const check=new DatabaseSync(file,{readOnly:true});assert.equal(check.prepare('SELECT last_uid FROM mail_cursors').get().last_uid,100);assert.equal(check.prepare('SELECT count(*) n FROM mail_messages').get().n,100);check.close();
});
