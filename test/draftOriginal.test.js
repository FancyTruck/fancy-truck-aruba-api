import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openMailDb} from '../src/peuMailDb.js';import {ArubaService} from '../src/peuMailService.js';
test('original lookup is exact and account scoped, excludes deleted/sent, retains source',()=>{
 const db=openMailDb(join(mkdtempSync(join(tmpdir(),'draft-original-')),'mail.db')),s=new ArubaService({db,accounts:['hello','pietro']});
 const insert=(account,folder,uid,messageId,text,deleted=0)=>db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,?)').run(account,folder,'1',uid,messageId,'thread',JSON.stringify({subject:'Identico oggetto',text,from:[{address:'client@example.invalid'}]}),'[]',deleted);
 insert('hello','INBOX',1,'<one>','Cliente uno');insert('hello','INBOX',2,'<two>','Cliente due');insert('pietro','INBOX',1,'<one>','Altra casella');insert('hello','Sent',1,'<sent>','Inviata');insert('hello','INBOX',3,'<deleted>','Eliminata',1);
 assert.equal(s.original('hello','<one>').original.payload.text,'Cliente uno');assert.equal(s.original('pietro','<one>').original.payload.text,'Altra casella');assert.equal(s.original('hello','<sent>').original,null);assert.equal(s.original('hello','<deleted>').original,null);
 insert('hello','INBOX',4,'<one>','Duplicata');assert.equal(s.original('hello','<one>').original,null);assert.equal(db.prepare('SELECT count(*) n FROM mail_messages').get().n,6);db.close();
});
