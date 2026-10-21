import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { validateState } from './stateBackup.js';
const prefix = 'fancy-ai-state-v1/';
const maxBytes = 32 * 1024 * 1024;
function keyBytes(key) {
  if (!/^[a-f0-9]{64}$/i.test(key || '')) throw Error('Chiave backup: richiesti 32 byte esadecimali');
  return Buffer.from(key,'hex');
}
export function encryptState(state, key) {
  const payload=Buffer.from(JSON.stringify(validateState(state)));
  if(payload.length>maxBytes) throw Error('Stato oltre il limite backup di 32 MB');
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',keyBytes(key),iv);
  const data=Buffer.concat([cipher.update(gzipSync(payload)),cipher.final()]);
  return Buffer.from(JSON.stringify({format:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}));
}
export function decryptState(bytes, key) {
  if(bytes.length>maxBytes*2) throw Error('Backup troppo grande');
  const box=JSON.parse(bytes.toString());
  if(box.format!==1)throw Error('Formato backup non supportato');
  const decipher=crypto.createDecipheriv('aes-256-gcm',keyBytes(key),Buffer.from(box.iv,'base64'));
  decipher.setAuthTag(Buffer.from(box.tag,'base64'));
  const compressed=Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]);
  return validateState(JSON.parse(gunzipSync(compressed,{maxOutputLength:maxBytes}).toString()));
}
export function backupClient(env) {
  for(const name of ['BACKUP_S3_ENDPOINT','BACKUP_S3_REGION','BACKUP_S3_BUCKET','BACKUP_S3_ACCESS_KEY_ID','BACKUP_S3_SECRET_ACCESS_KEY','BACKUP_ENCRYPTION_KEY'])if(!env[name])throw Error(`Backup non configurato: ${name}`);
  if(new URL(env.BACKUP_S3_ENDPOINT).protocol!=='https:')throw Error('Backup richiede HTTPS');
  keyBytes(env.BACKUP_ENCRYPTION_KEY);
  return new S3Client({endpoint:env.BACKUP_S3_ENDPOINT,region:env.BACKUP_S3_REGION,forcePathStyle:true,maxAttempts:2,
    credentials:{accessKeyId:env.BACKUP_S3_ACCESS_KEY_ID,secretAccessKey:env.BACKUP_S3_SECRET_ACCESS_KEY}});
}
async function send(client, command) { return client.send(command,{abortSignal:AbortSignal.timeout(30000)}); }
export async function downloadBackup(client, bucket, key, encryptionKey) {
  if(!/^fancy-ai-state-v1\/\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]+\.json\.enc$/.test(key))throw Error('Percorso backup non ammesso');
  const result=await send(client,new GetObjectCommand({Bucket:bucket,Key:key}));
  if(result.ContentLength>maxBytes*2)throw Error('Backup troppo grande');
  return decryptState(Buffer.from(await result.Body.transformToByteArray()),encryptionKey);
}
export async function runExternalBackup({store,env,now=new Date(),client}) {
  if(env.EXTERNAL_BACKUP_ENABLED!=='true')return {status:'DISABLED'};
  const marker=`external-backup:${now.toISOString().slice(0,10)}`;
  if(store.has(marker))return {status:'ALREADY_VERIFIED_TODAY'};
  const owned=!client;
  client ??= backupClient(env);
  try {
    const bucket=env.BACKUP_S3_BUCKET, snapshot=store.snapshot();
    const body=encryptState(snapshot,env.BACKUP_ENCRYPTION_KEY);
    const objects=[]; let token;
    do {
      const page=await send(client,new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,ContinuationToken:token}));
      objects.push(...(page.Contents||[]));
      if(objects.length>10000)throw Error('Troppi backup: verifica manuale richiesta');
      token=page.IsTruncated?page.NextContinuationToken:undefined;
      if(page.IsTruncated&&!token)throw Error('Elenco backup incompleto');
    } while(token);
    if(objects.reduce((sum,o)=>sum+(o.Size||0),0)+body.length>1024*1024*1024)throw Error('Limite prudenziale di 1 GB raggiunto');
    const key=`${prefix}${now.toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}.json.enc`;
    await send(client,new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:'application/octet-stream'}));
    const restored=await downloadBackup(client,bucket,key,env.BACKUP_ENCRYPTION_KEY);
    if(JSON.stringify(restored)!==JSON.stringify(snapshot))throw Error('Ripristino di controllo non corrispondente');
    const result={status:'VERIFIED',key,bytes:body.length,verified_at:now.toISOString()};
    store.remember(marker,result);
    // Only our dated backup objects, after successful download/decryption of a new copy.
    for(const item of objects) {
      if(/^fancy-ai-state-v1\/\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]+\.json\.enc$/.test(item.Key||'') && new Date(item.LastModified).getTime()<now.getTime()-30*86400000)
        await send(client,new DeleteObjectCommand({Bucket:bucket,Key:item.Key}));
    }
    return result;
  } finally { if(owned)client.destroy(); }
}
