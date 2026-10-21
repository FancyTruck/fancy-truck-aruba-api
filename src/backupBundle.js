import fs from 'node:fs';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import crypto from 'node:crypto';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip, createGunzip} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {validateState} from './stateBackup.js';

const MAGIC=Buffer.from('FANCYB02');
const MiB=1024*1024;
export const BUNDLE_LIMITS=Object.freeze({state:32*MiB,sqlite:256*MiB,manifest:64*1024,encrypted:300*MiB,plain:289*MiB});
export const bundleKeyPattern=/^fancy-ai-state-v1\/\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]+\.bundle\.enc$/;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function keyBytes(key){if(!/^[a-f0-9]{64}$/i.test(key||''))throw Error('Chiave backup non valida');return Buffer.from(key,'hex');}
export function byteLimit(max){let size=0;return new Transform({transform(chunk,_enc,done){size+=chunk.length;done(size>max?Error('Limite dimensioni backup superato'):null,chunk);}});}
export function privateDirectory(prefix='fancy-backup-'){return fs.mkdtempSync(join(tmpdir(),prefix));}
export function removePrivateDirectory(directory){fs.rmSync(directory,{recursive:true,force:true});}
async function fileHash(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
function checkSqlite(file,state){
 const db=new DatabaseSync(file,{readOnly:true});
 try {
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Integrità SQLite non valida');
  const counts={};
  for(const table of ['mail_messages','mail_cursors','peu_operations','peu_effects'])counts[table]=db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  for(const row of db.prepare('SELECT action_id,digest FROM peu_effects').iterate()){
   if(state.actions[row.action_id]?.peu_payload_hash!==row.digest)throw Error('Registro e approvazioni non coerenti');
  }
  return counts;
 } finally {db.close();}
}

// Synchronous on purpose: no JS callback can mutate either store between these
// two captures. The caller must also exclude all in-flight business operations.
// Only this single Node process owns the JSON/SQLite files on the Render disk.
export function captureBundle({store,db,directory,canCapture=()=>false}){
 if(!canCapture())throw Error('Backup rinviato: operazioni in corso');
 for(const table of ['peu_effects','peu_operations'])if(db.prepare(`SELECT 1 FROM ${table} WHERE status='executing' LIMIT 1`).get())throw Error('Backup rinviato: registro in esecuzione');
 const started_at=new Date().toISOString();
 const page=db.prepare('PRAGMA page_count').get().page_count, size=db.prepare('PRAGMA page_size').get().page_size;
 if(page*size>BUNDLE_LIMITS.sqlite)throw Error('SQLite oltre 256 MiB: rivedere capacità e conservazione');
 const disk=fs.statfsSync(directory);
 if(disk.bavail*disk.bsize<6*(page*size+BUNDLE_LIMITS.state))throw Error('Spazio temporaneo insufficiente per backup e ripristino isolato');
 const state=validateState(store.snapshot()), stateBytes=Buffer.from(JSON.stringify(state));
 if(stateBytes.length>BUNDLE_LIMITS.state)throw Error('Stato oltre 32 MiB');
 const stateFile=join(directory,'state.json'),sqliteFile=join(directory,'peu-aruba.sqlite');
 fs.writeFileSync(stateFile,stateBytes,{flag:'wx',mode:0o600});
 db.prepare('VACUUM INTO ?').run(sqliteFile);
 fs.chmodSync(sqliteFile,0o600);
 const bytes=fs.statSync(sqliteFile).size;
 if(bytes>BUNDLE_LIMITS.sqlite)throw Error('SQLite oltre limite');
 return {state,stateFile,sqliteFile,started_at,captured_at:new Date().toISOString(),counts:checkSqlite(sqliteFile,state)};
}

export async function sealBundle(capture,directory,key){
 const manifest={format:2,id:crypto.randomUUID(),started_at:capture.started_at,captured_at:capture.captured_at,
  consistency:'single-process-quiescent-synchronous',reconciliation_required:true,counts:capture.counts,
  files:[{name:'state.json',bytes:fs.statSync(capture.stateFile).size,sha256:await fileHash(capture.stateFile)},
         {name:'peu-aruba.sqlite',bytes:fs.statSync(capture.sqliteFile).size,sha256:await fileHash(capture.sqliteFile)}]};
 const json=Buffer.from(JSON.stringify(manifest)),length=Buffer.alloc(4);length.writeUInt32BE(json.length);
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',keyBytes(key),iv);
 cipher.setAAD(MAGIC);
 const file=join(directory,'bundle.enc');
 fs.writeFileSync(file,Buffer.concat([MAGIC,iv]),{flag:'wx',mode:0o600});
 async function* plain(){yield length;yield json;for(const path of [capture.stateFile,capture.sqliteFile])yield* fs.createReadStream(path);}
 await pipeline(Readable.from(plain()),createGzip(),cipher,byteLimit(BUNDLE_LIMITS.encrypted-36),fs.createWriteStream(file,{flags:'a'}));
 fs.appendFileSync(file,cipher.getAuthTag());
 return {file,manifest,bytes:fs.statSync(file).size,sha256:await fileHash(file)};
}

// Never imports the server, SMTP, Odoo, or polling code. Extraction is into a
// freshly created private directory; no caller-selected file is overwritten.
export async function restoreBundle(file,destination,key){
 if(fs.existsSync(destination))throw Error('Destinazione già esistente: non sovrascrivo');
 const size=fs.statSync(file).size;
 if(size<37||size>BUNDLE_LIMITS.encrypted)throw Error('Dimensioni backup non valide');
 const fd=fs.openSync(file,'r'),header=Buffer.alloc(20),tag=Buffer.alloc(16);
 try {fs.readSync(fd,header,0,20,0);fs.readSync(fd,tag,0,16,size-16);}finally{fs.closeSync(fd);}
 if(!header.subarray(0,8).equals(MAGIC))throw Error('Formato backup non supportato');
 const staging=fs.mkdtempSync(join(dirname(destination),'.fancy-restore-'));
 try {
  const raw=join(staging,'payload'),decipher=crypto.createDecipheriv('aes-256-gcm',keyBytes(key),header.subarray(8));
  decipher.setAAD(MAGIC);decipher.setAuthTag(tag);
  await pipeline(fs.createReadStream(file,{start:20,end:size-17}),decipher,createGunzip(),byteLimit(BUNDLE_LIMITS.plain),fs.createWriteStream(raw,{flags:'wx',mode:0o600}));
  const input=fs.openSync(raw,'r');let manifest,offset,stateBytes;
  try {
   const length=Buffer.alloc(4);if(fs.readSync(input,length,0,4,0)!==4)throw Error('Backup parziale');
   const n=length.readUInt32BE();if(n<2||n>BUNDLE_LIMITS.manifest)throw Error('Manifest non valido');
   const bytes=Buffer.alloc(n);if(fs.readSync(input,bytes,0,n,4)!==n)throw Error('Backup parziale');
   manifest=JSON.parse(bytes.toString());offset=4+n;
   if(manifest.format!==2||manifest.reconciliation_required!==true||!Array.isArray(manifest.files)||manifest.files.length!==2||!Number.isFinite(Date.parse(manifest.captured_at)))throw Error('Manifest non valido');
   for(const [i,name,max] of [[0,'state.json',BUNDLE_LIMITS.state],[1,'peu-aruba.sqlite',BUNDLE_LIMITS.sqlite]]){
    const f=manifest.files[i];if(f.name!==name||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>max||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('File manifest non valido');
   }
   if(fs.statSync(raw).size!==offset+manifest.files[0].bytes+manifest.files[1].bytes)throw Error('Backup parziale o dati aggiunti');
   stateBytes=Buffer.alloc(manifest.files[0].bytes);fs.readSync(input,stateBytes,0,stateBytes.length,offset);offset+=stateBytes.length;
  }finally{fs.closeSync(input);}
  if(digest(stateBytes)!==manifest.files[0].sha256)throw Error('Hash stato non valido');
  const state=validateState(JSON.parse(stateBytes.toString())),sqliteFile=join(staging,'peu-aruba.sqlite');
  await pipeline(fs.createReadStream(raw,{start:offset}),fs.createWriteStream(sqliteFile,{flags:'wx',mode:0o600}));
  if(await fileHash(sqliteFile)!==manifest.files[1].sha256)throw Error('Hash SQLite non valido');
  const counts=checkSqlite(sqliteFile,state);
  if(JSON.stringify(counts)!==JSON.stringify(manifest.counts))throw Error('Conteggi registro non corrispondenti');
  const recovery={required:true,backup_id:manifest.id,captured_at:manifest.captured_at,reason:'Reconcile Odoo, SMTP and approvals after backup before ANY external write'};
  state.recovery=recovery;
  const db=new DatabaseSync(sqliteFile);
  try {db.exec("CREATE TABLE IF NOT EXISTS peu_recovery(id INTEGER PRIMARY KEY CHECK(id=1),required INTEGER NOT NULL,details TEXT NOT NULL); UPDATE peu_effects SET status='unknown' WHERE status='executing'; UPDATE peu_operations SET status='unknown' WHERE status='executing';");
   db.prepare('INSERT OR REPLACE INTO peu_recovery VALUES(1,1,?)').run(JSON.stringify(recovery));
  }finally{db.close();}
  fs.writeFileSync(join(staging,'fancy-truck-state.json'),JSON.stringify(state),{flag:'wx',mode:0o600});
  fs.writeFileSync(join(staging,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
  fs.writeFileSync(join(staging,'RECOVERY_REQUIRED.json'),JSON.stringify(recovery),{flag:'wx',mode:0o600});
  fs.unlinkSync(raw);
  // Reserve an absent destination, then atomically replace our own empty
  // directory with the complete verified restore (same filesystem).
  fs.mkdirSync(destination,{mode:0o700});
  fs.renameSync(staging,destination);
  return {manifest,counts,recovery_required:true};
 }finally{removePrivateDirectory(staging);}
}
