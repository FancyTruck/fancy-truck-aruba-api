import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const source=fs.readFileSync(new URL('../scripts/start-from-reviewed-cutoff.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
test('fresh start cancels only pending actions, freezes reviewed cutoff and refuses a repeat',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fancy-start-'));
 try{
 const file=path.join(dir,'state.json');
 const state={actions:Object.fromEntries(Array.from({length:330},(_,i)=>[i,{status:'PENDING_APPROVAL'}])),
 cursors:{'imap:hello:last_uid':3693,'imap:pietro:last_uid':4313},events:[],idempotency:{},mail_operations:{}};
 state.actions.done={status:'EXECUTED'};fs.writeFileSync(file,JSON.stringify(state));
 const preview={complete:true,stateUnchanged:true,errors:[],messages:[
 ...Array.from({length:20},(_,i)=>({account:'hello',uid:3694+i})),
 ...Array.from({length:7},(_,i)=>({account:'pietro',uid:4315+i}))]};
 const fakeFs={...fs,readFileSync:(p,...args)=>p==='/var/data/fancy-startup-preview.json'?JSON.stringify(preview):
 p==='/var/data/fancy-startup-audit.json'?JSON.stringify({readyForDecision:true,odoo:{latest:{id:2865},pendingCount:0}}):fs.readFileSync(p,...args)};
 class ImapFlow{constructor(options){this.mailbox={uidValidity:options.auth.user==='hello'?'1724263363':'1754596100',uidNext:5000};}async connect(){}async mailboxOpen(_,options){assert(options.readOnly);}async logout(){}}
 const run=new (Object.getPrototypeOf(async function(){}).constructor)('fs','crypto','assert','ImapFlow','process','console',source);
 const proc={pid:123,env:{STATE_FILE:file,READ_ONLY:'true',AUTOMATION_ENABLED:'false',HELLO_EMAIL:'hello',PIETRO_EMAIL:'pietro'}};
 await run(fakeFs,crypto,assert,ImapFlow,proc,{log:()=>{}});
 const result=JSON.parse(fs.readFileSync(file));
 assert.equal(result.actions.done.status,'EXECUTED');
 assert.equal(Object.values(result.actions).filter(a=>a.status==='CANCELLED').length,330);
 assert.equal(result.cursors['imap:hello:checkpoint'].lastUid,3713);
 assert.equal(result.cursors['imap:pietro:checkpoint'].lastUid,4321);
 const saved=fs.readFileSync(file,'utf8');
 await assert.rejects(run(fakeFs,crypto,assert,ImapFlow,proc,{log:()=>{}}),/già preparato/);
 assert.equal(fs.readFileSync(file,'utf8'),saved);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(n=>n.includes('before-fresh-start'))))),state);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
