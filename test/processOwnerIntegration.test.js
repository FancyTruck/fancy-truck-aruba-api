import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Real server imports in separate processes; no actual provider credentials.
const script = `
 import {once} from 'node:events';
 import {createInterface} from 'node:readline';
 import nodemailer from 'nodemailer';
 globalThis.fetch=()=>{throw Error('Provider forbidden in ownership test');};
 nodemailer.createTransport=()=>{throw Error('SMTP forbidden in ownership test');};
 try {
  const {server,store}=await import('./src/server.js');
  if(!server.listening)await once(server,'listening');
  if(process.env.SEED_ACTIVE==='true'){
   store.beginCycle(['synthetic']);
   const {action}=store.createAction({type:'SEND_EMAIL',target:'fixture@example.invalid',
    payload:{subject:'Synthetic',text:'Never sent'},idempotency_key:'ownership-fixture',status:'APPROVED_FOR_EXECUTION'});
   store.beginSmtpExecution(action.id);
  }
  console.log('RESULT:'+JSON.stringify({started:true,file:store.filePath,
   cycles:store.state.cycles.map(c=>c.status),actions:Object.values(store.state.actions).map(a=>a.status)}));
  if(process.env.HOLD_PROCESS==='true'){
   createInterface({input:process.stdin}).on('line',async line=>{
    if(line==='close'){await new Promise(resolve=>server.close(resolve));console.log('CLOSED');}
   });
  }else await new Promise(resolve=>server.close(resolve));
 }catch(error){console.log('RESULT:'+JSON.stringify({started:false,code:error.code,message:error.message}));}
`;

function fixture(t) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fancy-owner-'));
 // Kill every held process before removing the synthetic state and lock files.
 const children=[];
 t.after(async()=>{
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await child.closed;}
  fs.rmSync(directory,{recursive:true,force:true});
 });
 return {directory,file:path.join(directory,'state.json'),children};
}

function start(f,extra={}) {
 const child=spawn(process.execPath,['--input-type=module','-e',script],{
  cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe'],
  env:{PATH:process.env.PATH,APP_ENV:'test',STATE_FILE:f.file,PORT:'0',API_TOKEN:'synthetic',
   READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',EXTERNAL_BACKUP_ENABLED:'false',...extra},
 });
 f.children.push(child);child.closed=new Promise(resolve=>child.once('close',resolve));
 let diagnostics='';child.stderr.on('data',chunk=>{diagnostics+=chunk;});
 const lines=createInterface({input:child.stdout});
 child.ready=new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Ownership child timeout: '+diagnostics));},15000);
  lines.on('line',line=>{if(line.startsWith('RESULT:')){clearTimeout(timeout);resolve(JSON.parse(line.slice(7)));}});
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{clearTimeout(timeout);reject(Error('Child exited before result '+code+': '+diagnostics));});
 });
 child.httpClosed=new Promise(resolve=>lines.on('line',line=>{if(line==='CLOSED')resolve();}));
 return child;
}

function activeOnDisk(f) {
 const state=JSON.parse(fs.readFileSync(f.file,'utf8'));
 assert.deepEqual(state.cycles.map(c=>c.status),['RUNNING']);
 assert.deepEqual(Object.values(state.actions).map(a=>a.status),['EXECUTING']);
}

test('second writable server cannot quarantine the active owner or change disk bytes',async t=>{
 const f=fixture(t),owner=start(f,{HOLD_PROCESS:'true',SEED_ACTIVE:'true'});
 assert.equal((await owner.ready).started,true);activeOnDisk(f);const before=fs.readFileSync(f.file,'utf8');
 const contender=start(f);assert.deepEqual(await contender.ready,{started:false,code:'STATE_OWNER_BUSY',message:'State is already owned by a server using this ownership file'});
 await contender.closed;assert.equal(fs.readFileSync(f.file,'utf8'),before);activeOnDisk(f);
});

test('read-only and restored observers leave the active owner and pending effects untouched',async t=>{
 const f=fixture(t),owner=start(f,{HOLD_PROCESS:'true',SEED_ACTIVE:'true'});
 assert.equal((await owner.ready).started,true);const before=fs.readFileSync(f.file,'utf8');
 for(const mode of ['readonly','restore']){
  if(mode==='restore')fs.writeFileSync(path.join(f.directory,'RECOVERY_REQUIRED.json'),'{}');
  const observer=start(f,{READ_ONLY:mode==='readonly'?'true':'false'}),result=await observer.ready;await observer.closed;
  assert.equal(result.started,true);assert.deepEqual(result.cycles,['RUNNING']);assert.deepEqual(result.actions,['EXECUTING']);
  assert.equal(fs.readFileSync(f.file,'utf8'),before);
 }
});

test('HTTP close retains ownership; kernel releases it after SIGKILL for one non-retrying recovery',async t=>{
 const f=fixture(t),owner=start(f,{HOLD_PROCESS:'true',SEED_ACTIVE:'true'});
 assert.equal((await owner.ready).started,true);const before=fs.readFileSync(f.file,'utf8');
 owner.stdin.write('close\n');await owner.httpClosed;
 const contender=start(f);assert.equal((await contender.ready).code,'STATE_OWNER_BUSY');await contender.closed;
 assert.equal(fs.readFileSync(f.file,'utf8'),before);
 owner.kill('SIGKILL');await owner.closed;
 const recovered=start(f);const result=await recovered.ready;await recovered.closed;
 assert.equal(result.started,true);assert.deepEqual(result.cycles,['INTERRUPTED']);assert.deepEqual(result.actions,['UNCERTAIN']);
 const settled=fs.readFileSync(f.file,'utf8'),again=start(f);assert.equal((await again.ready).started,true);await again.closed;
 assert.equal(fs.readFileSync(f.file,'utf8'),settled);
});

test('symlink file and directory aliases use the same owner identity across atomic saves',async t=>{
 const f=fixture(t),owner=start(f,{HOLD_PROCESS:'true',SEED_ACTIVE:'true'});
 assert.equal((await owner.ready).started,true);const before=fs.readFileSync(f.file,'utf8');
 fs.symlinkSync(f.file,path.join(f.directory,'alias.json'));
 fs.symlinkSync(f.directory,path.join(f.directory,'alias-dir'));
 for(const file of [path.join(f.directory,'alias.json'),path.join(f.directory,'alias-dir','state.json')]){
  const alias=start(f,{STATE_FILE:file});assert.equal((await alias.ready).code,'STATE_OWNER_BUSY');await alias.closed;
 }
 assert.equal(fs.readFileSync(f.file,'utf8'),before);
});

test('different state files can have independent owners; hardlinked state fails closed',async t=>{
 const f=fixture(t),owner=start(f,{HOLD_PROCESS:'true',SEED_ACTIVE:'true'});
 assert.equal((await owner.ready).started,true);
 const independent=start(f,{STATE_FILE:path.join(f.directory,'independent.json')});assert.equal((await independent.ready).started,true);await independent.closed;
 fs.linkSync(f.file,path.join(f.directory,'hardlink.json'));
 const hardlink=start(f,{STATE_FILE:path.join(f.directory,'hardlink.json')});assert.equal((await hardlink.ready).code,'STATE_OWNER_UNSAFE_PATH');await hardlink.closed;
 activeOnDisk(f);
});

test('simultaneous starts on an absent state file admit exactly one owner',async t=>{
 const f=fixture(t),children=Array.from({length:3},()=>start(f,{HOLD_PROCESS:'true'}));
 const results=await Promise.all(children.map(child=>child.ready));
 assert.equal(results.filter(result=>result.started).length,1);
 assert.equal(results.filter(result=>result.code==='STATE_OWNER_BUSY').length,2);
 assert.equal(fs.existsSync(f.file),false,'ownership itself does not create a state file');
});

test('initial symlink owner uses canonical state path for every atomic write',async t=>{
 const f=fixture(t);fs.writeFileSync(f.file,'{}');
 const alias=path.join(f.directory,'alias.json');fs.symlinkSync(f.file,alias);
 const owner=start(f,{STATE_FILE:alias,HOLD_PROCESS:'true',SEED_ACTIVE:'true'}),result=await owner.ready;
 assert.equal(result.started,true);assert.equal(result.file,fs.realpathSync(f.file));
 assert.equal(fs.lstatSync(alias).isSymbolicLink(),true);activeOnDisk(f);
 const canonical=start(f);assert.equal((await canonical.ready).code,'STATE_OWNER_BUSY');await canonical.closed;
});

test('unavailable or aliased ownership file and dangling state symlink fail before recovery',async t=>{
 const f=fixture(t);
 fs.writeFileSync(f.file,JSON.stringify({cycles:[{id:'synthetic',status:'RUNNING',errors:[]}]}));
 const before=fs.readFileSync(f.file,'utf8'),ownerFile=f.file+'.owner.sqlite';
 fs.writeFileSync(ownerFile,'not a database');
 const corrupt=start(f);assert.equal((await corrupt.ready).code,'STATE_OWNER_UNAVAILABLE');await corrupt.closed;
 assert.equal(fs.readFileSync(f.file,'utf8'),before);
 fs.unlinkSync(ownerFile);fs.symlinkSync(path.join(f.directory,'another.sqlite'),ownerFile);
 const alias=start(f);assert.equal((await alias.ready).code,'STATE_OWNER_UNSAFE_PATH');await alias.closed;
 assert.equal(fs.readFileSync(f.file,'utf8'),before);
 const dangling=path.join(f.directory,'dangling.json');fs.symlinkSync(path.join(f.directory,'missing.json'),dangling);
 const missing=start(f,{STATE_FILE:dangling});assert.equal((await missing.ready).code,'STATE_OWNER_UNSAFE_PATH');await missing.closed;
});
