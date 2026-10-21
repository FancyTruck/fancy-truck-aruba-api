import fs from 'node:fs';
import {backupClient,downloadBackup} from '../src/externalBackup.js';
import {downloadBundle} from '../src/externalBundleBackup.js';
import {restoreBundle,bundleKeyPattern,privateDirectory,removePrivateDirectory} from '../src/backupBundle.js';
import {join} from 'node:path';
const [key,destination]=process.argv.slice(2);
if(!key||!destination)throw Error('Uso: node scripts/restore-external-backup.js CHIAVE_OGGETTO NUOVO_FILE');
if(fs.existsSync(destination))throw Error('Destinazione già esistente: non sovrascrivo');
const client=backupClient(process.env);
try {
 if(bundleKeyPattern.test(key)){
   const temporary=privateDirectory('fancy-download-');
   try{
     const file=join(temporary,'backup.enc');
     await downloadBundle(client,process.env.BACKUP_S3_BUCKET,key,file);
     const result=await restoreBundle(file,destination,process.env.BACKUP_ENCRYPTION_KEY);
     console.log(JSON.stringify({status:'RESTORED_ISOLATED',format:2,counts:result.counts,recovery_required:true}));
   }finally{removePrivateDirectory(temporary);}
 }else{
 const state=await downloadBackup(client,process.env.BACKUP_S3_BUCKET,key,process.env.BACKUP_ENCRYPTION_KEY);
 state.recovery={required:true,reason:'Legacy JSON backup: SQLite ledger missing; reconcile before any write'};
 fs.writeFileSync(destination,JSON.stringify(state),{flag:'wx',mode:0o600});
 console.log('RIPRISTINO VERIFICATO SU FILE SEPARATO. Stato operativo non sostituito.');
 }
} finally {client.destroy();}
