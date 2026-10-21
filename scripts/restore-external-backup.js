import fs from 'node:fs';
import {backupClient,downloadBackup} from '../src/externalBackup.js';
const [key,destination]=process.argv.slice(2);
if(!key||!destination)throw Error('Uso: node scripts/restore-external-backup.js CHIAVE_OGGETTO NUOVO_FILE');
if(fs.existsSync(destination))throw Error('Destinazione già esistente: non sovrascrivo');
const client=backupClient(process.env);
try {
 const state=await downloadBackup(client,process.env.BACKUP_S3_BUCKET,key,process.env.BACKUP_ENCRYPTION_KEY);
 fs.writeFileSync(destination,JSON.stringify(state),{flag:'wx',mode:0o600});
 console.log('RIPRISTINO VERIFICATO SU FILE SEPARATO. Stato operativo non sostituito.');
} finally {client.destroy();}
