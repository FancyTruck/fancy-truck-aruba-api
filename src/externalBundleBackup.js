import fs from 'node:fs';
import crypto from 'node:crypto';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline,finished} from 'node:stream/promises';
import {PutObjectCommand,GetObjectCommand,ListObjectVersionsCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {captureBundle,sealBundle,restoreBundle,privateDirectory,removePrivateDirectory,byteLimit,BUNDLE_LIMITS,bundleKeyPattern} from './backupBundle.js';

const prefix='fancy-ai-state-v1/';
const send=(client,command)=>client.send(command,{abortSignal:AbortSignal.timeout(120000)});
export function backupFailureDetails(error){
 const message=String(error?.message||'');
 const rules=[['operazioni in corso','BUSY'],['registro in esecuzione','EXECUTING'],['SQLite oltre','SQLITE_SIZE_LIMIT'],['Spazio temporaneo','TEMP_SPACE'],['non coerenti','INCONSISTENT_STORES'],['no such table','MISSING_TABLE'],['1 GB','BUCKET_QUOTA'],['non corrispondente','HASH_MISMATCH']];
 const reason=rules.find(([text])=>message.includes(text))?.[1]||'BACKUP_FAILED';
 const names=['Error','InvalidArgument','InvalidRequest','NotImplemented','AccessDenied','NoSuchBucket','TimeoutError','AbortError','TypeError'];
 return {stage:error?.backupStage||'configuration',reason,type:names.includes(error?.name)?error.name:'OTHER',http_status:Number.isInteger(error?.$metadata?.httpStatusCode)?error.$metadata.httpStatusCode:undefined};
}
export async function downloadBundle(client,bucket,key,file){
 if(!bundleKeyPattern.test(key))throw Error('Percorso backup non ammesso');
 const result=await send(client,new GetObjectCommand({Bucket:bucket,Key:key}));
 if(result.ContentLength>BUNDLE_LIMITS.encrypted)throw Error('Backup troppo grande');
 const body=result.Body?.[Symbol.asyncIterator]?result.Body:Readable.fromWeb(result.Body.transformToWebStream());
 await pipeline(body,byteLimit(BUNDLE_LIMITS.encrypted),fs.createWriteStream(file,{flags:'wx',mode:0o600}));
 if(result.ContentLength!==undefined&&fs.statSync(file).size!==result.ContentLength)throw Error('Download parziale');
 const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);
 return h.digest('hex');
}
export async function runBundleBackup({store,db,env,client,now=new Date(),canCapture}){
 const marker=`external-bundle-v2:${now.toISOString().slice(0,10)}`;
 if(store.has(marker))return {status:'ALREADY_VERIFIED_TODAY',format:2};
 const directory=privateDirectory();
 let stage='capture';
 try {
  // Capture happens before the first await: no interleaving with application
  // handlers, background mail cache writes, or approval state changes.
  const capture=captureBundle({store,db,directory,canCapture});
  stage='encrypt';
  const sealed=await sealBundle(capture,directory,env.BACKUP_ENCRYPTION_KEY);
  stage='list';
  const objects=[];let keyMarker,versionMarker;
  do {
   const page=await send(client,new ListObjectVersionsCommand({Bucket:env.BACKUP_S3_BUCKET,Prefix:prefix,KeyMarker:keyMarker,VersionIdMarker:versionMarker}));
   objects.push(...(page.Versions||[]),...(page.DeleteMarkers||[]));
   if(objects.length>10000)throw Error('Troppi backup: verifica conservazione richiesta');
   const previous=JSON.stringify([keyMarker,versionMarker]);
   keyMarker=page.IsTruncated?page.NextKeyMarker:undefined;versionMarker=page.IsTruncated?page.NextVersionIdMarker:undefined;
   if(page.IsTruncated&&(!keyMarker||JSON.stringify([keyMarker,versionMarker])===previous))throw Error('Elenco versioni incompleto');
  }while(keyMarker);
  const storedBytes=objects.reduce((n,o)=>n+(o.Size||0),0);
  if(storedBytes+sealed.bytes>1024*1024*1024)throw Error('Limite prudenziale backup di 1 GB raggiunto');
  const key=`${prefix}${now.toISOString().replace(/[:.]/g,'-')}-${sealed.manifest.id}.bundle.enc`;
  stage='upload';
  const body=fs.createReadStream(sealed.file);
  const closed=finished(body).catch(()=>{});
  try {await send(client,new PutObjectCommand({Bucket:env.BACKUP_S3_BUCKET,Key:key,Body:body,ContentLength:sealed.bytes,ContentType:'application/octet-stream'}));}
  finally {body.destroy();await closed;}
  const downloaded=join(directory,'download.enc');
  stage='download';
  if(await downloadBundle(client,env.BACKUP_S3_BUCKET,key,downloaded)!==sealed.sha256)throw Error('Oggetto scaricato non corrispondente');
  stage='restore';
  const restored=await restoreBundle(downloaded,join(directory,'isolated-restore'),env.BACKUP_ENCRYPTION_KEY);
  // Verification uses only native file/SQLite access. No application is started,
  // and no credentials or external-action adapters reach the restore function.
  const result={status:'VERIFIED',format:2,key,bytes:sealed.bytes,stored_bytes_before:storedBytes,sha256:sealed.sha256,
   captured_at:sealed.manifest.captured_at,verified_at:new Date().toISOString(),counts:restored.counts,restore_writes_blocked:restored.recovery_required};
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
