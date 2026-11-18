import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mountPeuMail} from '../src/peuMailRoutes.js';
test('long sync results are consumed independently for each mailbox without restarting backfill',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'peu-routes-')),app=express();app.use(express.json());
 let release;const gate=new Promise(resolve=>{release=resolve;}),opened=[];
 const db=mountPeuMail(app,{stateFile:join(directory,'state.json'),parse:async()=>({}),withImap:async(account,fn)=>{opened.push(account);await gate;return fn({mailbox:{uidValidity:1,exists:0,uidNext:1},list:async()=>[{path:'INBOX'}],getMailboxLock:async(_f,options)=>{assert.equal(options.readOnly,true);return {release(){}};},search:async()=>[],async *fetch(){}});}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const sync=async account=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/v1/peu/aruba/${account}/sync`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:'INBOX'})});return {status:r.status,body:await r.json()};};
  const first=await Promise.all(['hello','pietro'].map(sync));assert(first.every(r=>r.body.status==='syncing'));assert.deepEqual(opened.sort(),['hello','pietro']);
  release();await new Promise(resolve=>setTimeout(resolve,20));
  const completed=await Promise.all(['hello','pietro'].map(sync));assert(completed.every(r=>r.body.status==='synced'));assert.equal(opened.length,2);
  assert.equal((await sync('other')).status,403);
 }finally{release();await new Promise(resolve=>server.close(resolve));db.close();rmSync(directory,{recursive:true,force:true});}
});
