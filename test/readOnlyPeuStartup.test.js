import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {openMailDb} from '../src/peuMailDb.js';
import {JsonStateStore} from '../src/store.js';
import {makePeuContract} from '../src/peuContract.js';
import {PeuWhatsAppGateway} from '../src/peuWhatsApp.js';
import {ApprovalService} from '../src/policy.js';

function fixture(t) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'readonly-peu-'));
 const file=path.join(directory,'state.json'),store=new JsonStateStore(file);store.save();
 const db=openMailDb(path.join(directory,'peu-aruba.sqlite'));
 db.exec(`CREATE TABLE peu_operations(key TEXT PRIMARY KEY,digest TEXT,status TEXT,result TEXT);
  CREATE TABLE peu_effects(action_id TEXT PRIMARY KEY,digest TEXT,status TEXT,result TEXT);
  INSERT INTO peu_operations VALUES('active-operation','synthetic','executing',NULL);
  INSERT INTO peu_effects VALUES('active-effect','synthetic','executing',NULL);`);
 db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,0)').run('pietro','INBOX','synthetic-validity',1,'synthetic-id','synthetic-thread',JSON.stringify({subject:'Synthetic cached message',text:'No real mail'}),'[]');
 t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
 return {directory,file,db};
}

const script=`
 import {once} from 'node:events';
 import nodemailer from 'nodemailer';
 import {ImapFlow} from 'imapflow';
 let providerCalls=0,backupTimers=0;
 const http=globalThis.fetch,timeout=globalThis.setTimeout,interval=globalThis.setInterval;
 globalThis.fetch=()=>{providerCalls++;throw Error('No provider fetch');};
 nodemailer.createTransport=()=>{providerCalls++;throw Error('No SMTP');};
 ImapFlow.prototype.connect=async()=>{providerCalls++;throw Error('No IMAP');};
 // Observe scheduling without ever running a backup/provider callback.
 globalThis.setTimeout=(fn,delay,...args)=>{if(delay===5000){backupTimers++;return timeout(()=>{},1).unref();}return timeout(fn,delay,...args);};
 globalThis.setInterval=(fn,delay,...args)=>{if(delay===3600000){backupTimers++;return timeout(()=>{},1).unref();}return interval(fn,delay,...args);};
 try {
  const {server}=await import('./src/server.js');if(!server.listening)await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port,headers={authorization:'Bearer synthetic-peu','content-type':'application/json'};
  const messages=await http(base+'/v1/peu/aruba/pietro/messages?folder=INBOX',{headers});
  const operation=await http(base+'/v1/peu/operations/active-operation',{headers});
  let sync,command;
  if(process.env.TEST_OBSERVER==='true'){
   sync=(await http(base+'/v1/peu/aruba/pietro/sync',{method:'POST',headers,body:JSON.stringify({folder:'INBOX'})})).status;
   command=(await http(base+'/v1/peu/commands',{method:'POST',headers,body:'{}'})).status;
  }
  console.log('RESULT:'+JSON.stringify({started:true,backupTimers,providerCalls,messages:messages.status,
   cached:await messages.json(),operation:await operation.json(),sync,command}));
  await new Promise(resolve=>server.close(resolve));
 }catch(error){console.log('RESULT:'+JSON.stringify({started:false,code:error.code,message:error.message,providerCalls,backupTimers}));}
`;
function run(f,mode) {
 const output=execFileSync(process.execPath,['--input-type=module','-e',script],{
  cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:15000,
  env:{PATH:process.env.PATH,APP_ENV:'test',STATE_FILE:f.file,PORT:'0',API_TOKEN:'synthetic-admin',PEU_ACCESS_TOKEN:'synthetic-peu',
   PIETRO_EMAIL:'fixture@example.invalid',PIETRO_PASSWORD:'synthetic',READ_ONLY:mode==='readonly'?'true':'false',
   AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'true',TEST_OBSERVER:mode==='owner'?'false':'true'},
 });
 return JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT:')).slice(7));
}

for(const mode of ['readonly','restore'])test(`actual ${mode} Peu startup preserves pending ledger, serves cached reads and blocks sync before IMAP`,t=>{
 const f=fixture(t),before=fs.readFileSync(f.file,'utf8');
 if(mode==='restore')fs.writeFileSync(path.join(f.directory,'RECOVERY_REQUIRED.json'),'{}');
 const result=run(f,mode);assert.equal(result.started,true);
 assert.equal(result.messages,200);assert.equal(result.cached.messages[0].payload.subject,'Synthetic cached message');
 assert.equal(result.operation.status,'executing');
 assert.equal(result.sync,403);assert.equal(result.command,403);assert.equal(result.providerCalls,0);assert.equal(result.backupTimers,0);
 assert.equal(f.db.prepare('SELECT status FROM peu_operations').get().status,'executing');
 assert.equal(f.db.prepare('SELECT status FROM peu_effects').get().status,'executing');
 assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='peu_whatsapp_replies'").get().n,0,'observer does not create a bridge schema');
 assert.equal(fs.readFileSync(f.file,'utf8'),before);assert.equal(fs.existsSync(f.file+'.owner.sqlite'),false);
});

test('actual writable owner still initializes bridges and quarantines interrupted Peu effects',t=>{
 const f=fixture(t),result=run(f,'owner');assert.equal(result.started,true);assert.equal(result.operation.status,'unknown');
 assert.equal(f.db.prepare('SELECT status FROM peu_effects').get().status,'unknown');
 assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='peu_whatsapp_replies'").get().n,1);
 assert.equal(result.backupTimers,2);assert.equal(result.providerCalls,0);assert.equal(fs.existsSync(f.file+'.owner.sqlite'),true);
});

test('read-only bridge entrypoints reject before ledger access and provider receipt refresh',async t=>{
 const f=fixture(t),db=openMailDb(path.join(f.directory,'peu-aruba.sqlite'),{readOnly:true});t.after(()=>db.close());
 const forbidden=()=>assert.fail('No provider or write assertion should be reached');
 const contract=makePeuContract({db,approvals:new ApprovalService(new JsonStateStore(f.file)),readOnly:true,assertWritable:forbidden,upstream:forbidden});
 await assert.rejects(contract.execute({}),error=>error.code==='read_only'&&error.status===403);
 const gateway=new PeuWhatsAppGateway({db,readOnly:true,assertWritable:forbidden,call:forbidden});
 await assert.rejects(gateway.reply({id:1,event_id:'synthetic',text:'No send'}),error=>error.code==='read_only'&&error.status===403);
 assert.equal(f.db.prepare('SELECT status FROM peu_effects').get().status,'executing');
});

test('read-only cache open requires an existing DB without creating a directory or schema',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'readonly-missing-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const missing=path.join(directory,'absent','cache.sqlite');
 assert.throws(()=>openMailDb(missing,{readOnly:true}));assert.equal(fs.existsSync(path.dirname(missing)),false);
});
