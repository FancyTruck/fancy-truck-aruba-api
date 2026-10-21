import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {openMailDb} from '../src/peuMailDb.js';
import {JsonStateStore} from '../src/store.js';
import {ApprovalService} from '../src/policy.js';
import {makePeuContract} from '../src/peuContract.js';
import {hash} from '../src/peuCommon.js';
import {captureBundle,sealBundle,restoreBundle,privateDirectory,removePrivateDirectory} from '../src/backupBundle.js';
import {runExternalBackup} from '../src/externalBackup.js';
import {recoveryRequired,applyRecoveryGuard} from '../src/recoveryGuard.js';
import {assertWritable,readOnlyMiddleware} from '../src/runtime.js';

const key='c'.repeat(64);
function fixture(t){
 const directory=privateDirectory('fancy-bundle-test-'),store=new JsonStateStore(join(directory,'state.json')),db=openMailDb(join(directory,'peu-aruba.sqlite'));
 const approvals=new ApprovalService(store,'test-only');let sent=0;
 const config={db,approvals,assertWritable(){},upstream:async()=>{throw Error('External writes disabled in test');},verify:async()=>{throw Error('External writes disabled');},smtp:async()=>{sent++;return {accepted:['test@example.invalid'],rejected:[],messageId:'synthetic'};}};
 const contract=makePeuContract(config);
 db.prepare('INSERT INTO mail_cursors VALUES(?,?,?,?)').run('pietro','INBOX','123',1);
 db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,?)').run('pietro','INBOX','123',1,'synthetic','thread','{"text":"synthetic"}','[]',0);
 const command=(capability,parameters,id)=>{const c=contract.catalog().capabilities.find(x=>x.id===capability);return {capability,parameters,idempotency_key:id,operation_id:id,confirmation:{confirmed:true,payload_hash:hash({provider:'fancy',capability,domain:'work',payload:{parameters,catalog_hash:hash(c)},effect:c.effect,confirmation:c.confirmation})}};};
 const prepare=async id=>{const p=(await contract.execute(command('mail.prepare',{account:'pietro',to:'test@example.invalid',subject:id,text:'synthetic'},id))).result;const a=approvals.approveCommand(p.action_id,'Pietro',`APPROVA ${p.action_id}`);approvals.confirm(p.action_id,'Pietro',a.confirmation_token);return {action_id:p.action_id,payload_hash:p.payload_hash};};
 t.after(()=>{db.close();removePrivateDirectory(directory);});
 return {directory,store,db,contract,config,command,prepare,get sent(){return sent;}};
}
function capture(f){const directory=join(f.directory,'capture');fs.mkdirSync(directory);return {directory,capture:captureBundle({...f,directory,canCapture:()=>true})};}

test('coherent encrypted bundle restores both stores, deduplicates success and blocks post-backup effects',async t=>{
 const f=fixture(t),done=await f.prepare('done');await f.contract.execute(f.command('mail.send',done,'send-done'));
 const pending=await f.prepare('after-backup');
 const c=capture(f),sealed=await sealBundle(c.capture,c.directory,key);
 // This external effect happened after the snapshot and is absent from it.
 await f.contract.execute(f.command('mail.send',pending,'send-later'));assert.equal(f.sent,2);
 const destination=join(f.directory,'restore'),r=await restoreBundle(sealed.file,destination,key);
 assert.equal(r.counts.mail_messages,1);assert.equal(r.counts.peu_effects,1);assert.equal(r.recovery_required,true);
 const store=new JsonStateStore(join(destination,'fancy-truck-state.json')),db=openMailDb(join(destination,'peu-aruba.sqlite'));
 try{
  const restored=makePeuContract({...f.config,db,approvals:new ApprovalService(store,'test-only')});
  assert.equal((await restored.execute(f.command('mail.send',done,'new-key'))).result.status,'accepted_by_smtp');
  await assert.rejects(restored.execute(f.command('mail.send',pending,'new-after-key')),/recovery_reconciliation_required/);
  await assert.rejects(restored.execute(f.command('crm.create',{name:'No writes',partner_id:1},'crm')),/recovery_reconciliation_required/);
  assert.equal(f.sent,2);
  const runtime=applyRecoveryGuard({stateFile:store.filePath,readOnly:false,automationEnabled:true},store.state);
  assert.equal(runtime.automationEnabled,false);assert.throws(()=>assertWritable(runtime),/sola lettura/);
  let status;readOnlyMiddleware(runtime)({method:'POST'},{status(s){status=s;return this;},json(){}},()=>assert.fail());assert.equal(status,403);
  // SQLite alone still enforces quarantine if JSON marker/files are omitted.
  fs.unlinkSync(join(destination,'RECOVERY_REQUIRED.json'));delete store.state.recovery;
  assert.equal(recoveryRequired(store.filePath,store.state),true);
 }finally{db.close();}
});
test('wrong key, tampering, truncated bundle and overwrite are refused without publishing partial restore',async t=>{
 const f=fixture(t),c=capture(f),sealed=await sealBundle(c.capture,c.directory,key),destination=join(f.directory,'restore');
 await assert.rejects(restoreBundle(sealed.file,destination,'d'.repeat(64)));assert(!fs.existsSync(destination));
 const damaged=join(f.directory,'damaged.enc'),bytes=fs.readFileSync(sealed.file);bytes[30]^=1;fs.writeFileSync(damaged,bytes);
 await assert.rejects(restoreBundle(damaged,destination,key));assert(!fs.existsSync(destination));
 fs.writeFileSync(damaged,bytes.subarray(0,25));await assert.rejects(restoreBundle(damaged,destination,key));
 await restoreBundle(sealed.file,destination,key);
 await assert.rejects(restoreBundle(sealed.file,destination,key),/esistente/);
 assert(!fs.readdirSync(f.directory).some(n=>n.startsWith('.fancy-restore-')));
});
test('capture refuses active handlers, executing ledger rows, inconsistent approval and missing Peu database',async t=>{
 const f=fixture(t);
 assert.throws(()=>captureBundle({...f,canCapture:()=>false}),/operazioni in corso/);
 f.db.prepare("INSERT INTO peu_operations VALUES('busy','h','executing',NULL)").run();
 assert.throws(()=>captureBundle({...f,canCapture:()=>true}),/registro in esecuzione/);
 await assert.rejects(runExternalBackup({store:f.store,env:{EXTERNAL_BACKUP_ENABLED:'true',PEU_ACCESS_TOKEN:'synthetic'}}),/Registro Peu/);
 f.db.exec('DELETE FROM peu_operations');
 f.db.prepare("INSERT INTO peu_effects VALUES('missing-action','hash','succeeded','{}')").run();
 assert.throws(()=>capture(f),/non coerenti/);
});
function mockBucket({failure,versions=[]}={}){
 const calls=[];let uploaded;
 return {calls,async send(command){
  const name=command.constructor.name;calls.push(name);
  if(name==='ListObjectVersionsCommand')return {Versions:versions};
  if(name==='PutObjectCommand'){
   if(failure==='upload')throw Error('upload failed');
   const chunks=[];for await(const c of command.input.Body)chunks.push(c);uploaded=Buffer.concat(chunks);return {};
  }
  if(name==='GetObjectCommand'){
   if(failure==='download')throw Error('download failed');
   const bytes=failure==='partial'?uploaded.subarray(0,25):Buffer.from(uploaded);
   if(failure==='tamper')bytes[30]^=1;
   return {ContentLength:uploaded.length,Body:Readable.from([bytes])};
  }
  if(name==='DeleteObjectCommand')return {};
  throw Error('Unexpected mock operation');
 }};
}
const env={EXTERNAL_BACKUP_ENABLED:'true',PEU_ACCESS_TOKEN:'synthetic',BACKUP_S3_BUCKET:'synthetic',BACKUP_ENCRYPTION_KEY:key};
test('upload then download and isolated restore verify the new format even after legacy daily success',async t=>{
 const f=fixture(t),now=new Date(),client=mockBucket({versions:[{Key:'fancy-ai-state-v1/2020-01-01T00-00-00-000Z-abc.bundle.enc',VersionId:'old',Size:20,LastModified:new Date('2020-01-01')}]});
 f.store.remember(`external-backup:${now.toISOString().slice(0,10)}`,{});
 const result=await runExternalBackup({...f,env,client,now,canCapture:()=>true});
 assert.equal(result.format,2);assert.equal(result.status,'VERIFIED');assert.equal(result.restore_writes_blocked,true);
 assert.equal(result.counts.mail_messages,1);
 assert.deepEqual(client.calls,['ListObjectVersionsCommand','PutObjectCommand','GetObjectCommand','DeleteObjectCommand']);
 assert.equal((await runExternalBackup({...f,env,client,now,canCapture:()=>true})).status,'ALREADY_VERIFIED_TODAY');
});
for(const failure of ['upload','download','partial','tamper'])test(`${failure} failure never marks verified or deletes old backups`,async t=>{
 const f=fixture(t),client=mockBucket({failure});
 await assert.rejects(runExternalBackup({...f,env,client,canCapture:()=>true}));
 assert(!client.calls.includes('DeleteObjectCommand'));
 assert(!Object.keys(f.store.state.idempotency).some(k=>k.startsWith('external-bundle-v2:')));
});
test('quota includes hidden versions and prevents upload; legacy objects never deleted by bundle retention',async t=>{
 const f=fixture(t),client=mockBucket({versions:[{Key:'old',Size:1024*1024*1024,IsLatest:false}]});
 await assert.rejects(runExternalBackup({...f,env,client,canCapture:()=>true}),/1 GB/);
 assert.deepEqual(client.calls,['ListObjectVersionsCommand']);
 const legacy=mockBucket({versions:[{Key:'fancy-ai-state-v1/2020-01-01T00-00-00-000Z-abc.json.enc',VersionId:'legacy',Size:20,LastModified:new Date('2020-01-01')}]});
 await runExternalBackup({...f,env,client:legacy,canCapture:()=>true});assert(!legacy.calls.includes('DeleteObjectCommand'));
});
test('restored server overrides writable settings and exposes recovery and missing-backup status', {timeout:15000},async t=>{
 const f=fixture(t),c=capture(f),sealed=await sealBundle(c.capture,c.directory,key),destination=join(f.directory,'restore');
 await restoreBundle(sealed.file,destination,key);
 const child=spawn(process.execPath,['src/server.js'],{cwd:new URL('..',import.meta.url),env:{PATH:process.env.PATH,APP_ENV:'test',PORT:'0',
  API_TOKEN:'synthetic-admin',PEU_ACCESS_TOKEN:'synthetic-peu',READ_ONLY:'false',AUTOMATION_ENABLED:'true',STARTUP_CHECKS:'false',STATE_FILE:join(destination,'fancy-truck-state.json')},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}});
 const base=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>reject(Error('Server exited')));child.stdout.on('data',chunk=>{const m=String(chunk).match(/porta (\d+)/);if(m)resolve(`http://127.0.0.1:${m[1]}`);});});
 const headers={authorization:'Bearer synthetic-admin','content-type':'application/json'};
 const diagnostic=await(await fetch(base+'/v1/diagnostics',{headers})).json();
 assert.equal(diagnostic.recovery_required,true);assert.equal(diagnostic.read_only,true);assert.equal(diagnostic.automation_status,'DISABLED');assert.equal(diagnostic.backup.status,'DISABLED');
 for(const path of ['/automation/run','/odoo/crm/leads','/actions/no/execute','/approvals/no/confirm','/peu/commands'])assert.equal((await fetch(base+'/v1'+path,{method:'POST',headers,body:'{}'})).status,403);
});
