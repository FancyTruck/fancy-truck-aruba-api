import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openMailDb} from '../src/peuMailDb.js';import {ArubaService} from '../src/peuMailService.js';
test('original lookup is exact and account scoped, excludes deleted/sent, retains source',()=>{
 const db=openMailDb(join(mkdtempSync(join(tmpdir(),'draft-original-')),'mail.db')),s=new ArubaService({db,accounts:['hello','pietro']});
 const insert=(account,folder,uid,messageId,text,deleted=0)=>db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,?)').run(account,folder,'1',uid,messageId,'thread',JSON.stringify({subject:'Identico oggetto',text,from:[{address:'client@example.invalid'}]}),'[]',deleted);
 insert('hello','INBOX',1,'<one>','Cliente uno');insert('hello','INBOX',2,'<two>','Cliente due');insert('pietro','INBOX',1,'<one>','Altra casella');insert('hello','Sent',1,'<sent>','Inviata');insert('hello','INBOX',3,'<deleted>','Eliminata',1);
 assert.equal(s.original('hello','<one>').original.payload.text,'Cliente uno');assert.equal(s.original('pietro','<one>').original.payload.text,'Altra casella');assert.equal(s.original('hello','<sent>').original,null);assert.equal(s.original('hello','<deleted>').original,null);
 insert('hello','INBOX',4,'<one>','Duplicata');assert.equal(s.original('hello','<one>').original,null);assert.equal(db.prepare('SELECT count(*) n FROM mail_messages').get().n,6);db.close();
});

test('missing original is retrieved read-only from exact inbox message, with identity rechecked',async()=>{
 const db=openMailDb(join(mkdtempSync(join(tmpdir(),'draft-imap-')),'mail.db'));let released=0,reads=0;
 const client={mailbox:{exists:1,uidNext:43,uidValidity:"1"},getMailboxLock:async(folder,opts)=>{assert.equal(folder,'INBOX');assert.equal(opts.readOnly,true);return {release(){released++;}};},search:async(query,opts)=>{assert.equal(query.header['message-id'],'<exact>');assert.equal(opts.uid,true);return [42];},fetchOne:async(uid,query)=>{assert.equal(uid,42);reads++;return query.size?{size:100}:{source:Buffer.from('mail')};}};
 let parsed={messageId:'<wrong>',text:'Wrong original'};
 const s=new ArubaService({db,accounts:['hello'],withImap:async(account,fn)=>{assert.equal(account,'hello');return fn(client);},parse:async()=>parsed});
 assert.equal((await s.draftOriginal('hello','<exact>')).original,null);
 parsed={messageId:'<exact>',text:'Exact original',from:{value:[{address:'client@example.invalid'}]}};
 assert.equal((await s.draftOriginal('hello','<exact>')).original.payload.text,'Exact original');assert.equal(released,2);assert.equal(reads,4);assert.equal(db.prepare('SELECT count(*) n FROM mail_messages').get().n,0);db.close();
});
