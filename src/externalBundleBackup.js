import fs from 'node:fs';
import crypto from 'node:crypto';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline,finished} from 'node:stream/promises';
import {PutObjectCommand,GetObjectCommand,ListObjectVersionsCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {captureBundle,sealBundle,privateDirectory,removePrivateDirectory,byteLimit,BUNDLE_LIMITS,bundleKeyPattern} from './backupBundle.js';
import {isolatedBackupRestore} from './isolatedBackupRestore.js';

const prefix='fancy-ai-state-v1/';
const send=(client,command)=>client.send(command,{abortSignal:AbortSignal.timeout(120000)});
export function backupFailureDetails(error){
 const message=String(error?.message||'');
 const rules=[['operazioni in corso','BUSY'],['registro in esecuzione','EXECUTING'],['SQLite oltre','SQLITE_SIZE_LIMIT'],['Spazio temporaneo','TEMP_SPACE'],['non coerenti','INCONSISTENT_STORES'],['no such table','MISSING_TABLE'],['1 GB','BUCKET_QUOTA'],['non corrispondente','HASH_MISMATCH']];
 const reason=rules.find(([text])=>message.includes(text))?.[1]||'BACKUP_FAILED';
 const names=['Error','InvalidArgument','InvalidRequest','NotImplemented','AccessDenied','NoSuchBucket','TimeoutError','AbortError','TypeError','InternalError','ServiceUnavailable','RequestTimeout','BadRequest'];
 return {stage:error?.backupStage||'configuration',reason,type:names.includes(error?.name)?error.name:'OTHER',http_status:Number.isInteger(error?.$metadata?.httpStatusCode)?error.$metadata.httpStatusCode:undefined};
}
export async function downloadBundle(client,bucket,key,file){
 if(!bundleKeyPattern.test(key))throw Error('Percorso backup non ammesso');
 const result=await send(client,new GetObjectCommand({Bucket:bucket,Key:key}));
 if(result.ContentLength>BUNDLE_LIMITS.encrypted)throw Error('Backup troppo grande');
 const body=result.Body?.[Symbol.asyncIterator]?result.Body:Readable.fromWeb(result.Body.transformToWebStream());
 let reported=0;
 await pipeline(body,byteLimit(BUNDLE_LIMITS.encrypted,size=>{if(size-reported>=64*1024*1024){reported=size;console.log(JSON.stringify({event:'external_backup_download_progress',bytes:size,rss:process.memoryUsage().rss}));}}),fs.createWriteStream(file,{flags:'wx',mode:0o600}));
 if(result.ContentLength!==undefined&&fs.statSync(file).size!==result.ContentLength)throw Error('Download parziale');
 const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);
 return h.digest('hex');
}
async function listBackupObjects(client,bucket){
 const objects=[];let keyMarker,versionMarker;
 do{
  const page=await send(client,new ListObjectVersionsCommand({Bucket:bucket,Prefix:prefix,KeyMarker:keyMarker,VersionIdMarker:versionMarker}));
  objects.push(...(page.Versions||[]),...(page.DeleteMarkers||[]));
  if(objects.length>10000)throw Error('Troppi backup: verifica conservazione richiesta');
  const previous=JSON.stringify([keyMarker,versionMarker]);
  keyMarker=page.IsTruncated?page.NextKeyMarker:undefined;versionMarker=page.IsTruncated?page.NextVersionIdMarker:undefined;
  if(page.IsTruncated&&(!keyMarker||JSON.stringify([keyMarker,versionMarker])===previous))throw Error('Elenco versioni incompleto');
 }while(keyMarker);
 return objects;
}
export async function runBundleBackup({store,db,env,client,now=new Date(),canCapture}){
 const marker=`external-bundle-v2:${now.toISOString().slice(0,10)}`;
 if(store.has(marker)){
  const previous=store.remember(marker).result;
  if(previous?.isolated_process===true)return {status:'ALREADY_VERIFIED_TODAY',format:2};
  // Upgrade today's earlier in-process verification without uploading a second
  // large object or consuming more bucket quota.
  const directory=privateDirectory();
  try{
   const file=join(directory,'download.enc');
   if(await downloadBundle(client,env.BACKUP_S3_BUCKET,previous.key,file)!==previous.sha256)throw Error('Oggetto scaricato non corrispondente');
   const restored=await isolatedBackupRestore(file,join(directory,'isolated-restore'),env.BACKUP_ENCRYPTION_KEY);
   const result={...previous,verified_at:new Date().toISOString(),isolated_process:true,restore_writes_blocked:restored.recovery_required};
   store.state.idempotency[marker].result=result;
   try{store.save();}catch(error){store.state.idempotency[marker].result=previous;throw error;}
   return result;
  }finally{removePrivateDirectory(directory);}
 }
 const directory=privateDirectory();
 let stage='list';
 try {
  const objects=await listBackupObjects(client,env.BACKUP_S3_BUCKET);
  const storedBytes=objects.reduce((n,o)=>n+(o.Size||0),0);
  // An upload may have completed before a process interruption. Reuse today's
  // authenticated encrypted object instead of making duplicate large uploads.
  const existing=objects.filter(o=>o.IsLatest!==false&&o.Size>0&&bundleKeyPattern.test(o.Key||'')&&o.Key.startsWith(prefix+now.toISOString().slice(0,10)+'T'))
    .sort((a,b)=>new Date(b.LastModified)-new Date(a.LastModified))[0];
  if(existing){
   console.log(JSON.stringify({event:'external_backup_progress',stage:'resume_uploaded',bytes:existing.Size}));
   stage='download';const file=join(directory,'download.enc');
   const sha256=await downloadBundle(client,env.BACKUP_S3_BUCKET,existing.Key,file);
   console.log(JSON.stringify({event:'external_backup_progress',stage:'downloaded',bytes:fs.statSync(file).size}));
   stage='restore';const restored=await isolatedBackupRestore(file,join(directory,'isolated-restore'),env.BACKUP_ENCRYPTION_KEY);
   const result={status:'VERIFIED',format:2,key:existing.Key,bytes:fs.statSync(file).size,stored_bytes_before:storedBytes,sha256,
    captured_at:restored.manifest.captured_at,verified_at:new Date().toISOString(),counts:restored.counts,restore_writes_blocked:true,isolated_process:true,
    source_bytes:{state:restored.manifest.files[0].bytes,sqlite:restored.manifest.files[1].bytes},estimated_daily_copies_within_quota:Math.floor((1024*1024*1024-storedBytes)/existing.Size),resumed:true};
   stage='record';store.remember(marker,result);return result;
  }
  stage='capture';
  // captureBundle is synchronous after its quiescence check: no interleaving
  // with handlers, mail cache writes, or approval changes during the snapshot.
  const capture=captureBundle({store,db,directory,canCapture});
  console.log(JSON.stringify({event:'external_backup_progress',stage:'captured',sqlite_bytes:fs.statSync(capture.sqliteFile).size}));
  stage='encrypt';
  const sealed=await sealBundle(capture,directory,env.BACKUP_ENCRYPTION_KEY);
  console.log(JSON.stringify({event:'external_backup_progress',stage:'encrypted',bytes:sealed.bytes}));
  stage='quota';
  if(storedBytes+sealed.bytes>1024*1024*1024)throw Error('Limite prudenziale backup di 1 GB raggiunto');
  const key=`${prefix}${now.toISOString().replace(/[:.]/g,'-')}-${sealed.manifest.id}.bundle.enc`;
  stage='upload';
  const body=fs.createReadStream(sealed.file);
  const closed=finished(body).catch(()=>{});
  try {await send(client,new PutObjectCommand({Bucket:env.BACKUP_S3_BUCKET,Key:key,Body:body,ContentLength:sealed.bytes,ContentMD5:sealed.contentMD5,ContentType:'application/octet-stream'}));}
  finally {body.destroy();await closed;}
  console.log(JSON.stringify({event:'external_backup_progress',stage:'uploaded',bytes:sealed.bytes}));
  const downloaded=join(directory,'download.enc');
  stage='download';
  if(await downloadBundle(client,env.BACKUP_S3_BUCKET,key,downloaded)!==sealed.sha256)throw Error('Oggetto scaricato non corrispondente');
  console.log(JSON.stringify({event:'external_backup_progress',stage:'downloaded',bytes:sealed.bytes}));
  stage='restore';
  const restored=await isolatedBackupRestore(downloaded,join(directory,'isolated-restore'),env.BACKUP_ENCRYPTION_KEY);
  // Verification uses only native file/SQLite access. No application is started,
  // and no credentials or external-action adapters reach the restore function.
  const result={status:'VERIFIED',format:2,key,bytes:sealed.bytes,stored_bytes_before:storedBytes,sha256:sealed.sha256,
   captured_at:sealed.manifest.captured_at,verified_at:new Date().toISOString(),counts:restored.counts,restore_writes_blocked:restored.recovery_required,isolated_process:restored.isolated_process,
   source_bytes:{state:sealed.manifest.files[0].bytes,sqlite:sealed.manifest.files[1].bytes},
   estimated_daily_copies_within_quota:Math.floor((1024*1024*1024-storedBytes)/sealed.bytes)};
  // Keep legacy JSON copies unchanged; only this format's exact managed keys
  // older than 30 days can be removed after a verified replacement exists.
  stage='retention';
  for(const item of objects)if(bundleKeyPattern.test(item.Key||'')&&new Date(item.LastModified).getTime()<now.getTime()-30*86400000){
   if(!item.VersionId)throw Error('Versione backup mancante: conservazione interrotta');
   await send(client,new DeleteObjectCommand({Bucket:env.BACKUP_S3_BUCKET,Key:item.Key,VersionId:item.VersionId}));
  }
  stage='record';store.remember(marker,result);return result;
 }catch(error){error.backupStage=stage;throw error;}
 finally{removePrivateDirectory(directory);}
}
