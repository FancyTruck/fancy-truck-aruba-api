import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function isolatedBackupRestore(file,destination,key){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/verify-backup-isolated.js',import.meta.url)),file,destination],{env:{},stdio:['pipe','pipe','pipe']});
  let output='',failed=false;
  const timeout=setTimeout(()=>{failed=true;child.kill('SIGKILL');},180000);
  child.on('error',()=>{failed=true;clearTimeout(timeout);reject(Error('Isolated restore process failed'));});
  child.stdin.on('error',()=>{failed=true;});
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>16384){failed=true;child.kill('SIGKILL');}});
  let diagnostics='';
  child.stderr.on('data',chunk=>{
   diagnostics+=chunk;
   if(diagnostics.length>16384){diagnostics='';return;}
   let end;
   while((end=diagnostics.indexOf('\n'))>=0){
    const line=diagnostics.slice(0,end);diagnostics=diagnostics.slice(end+1);
    try{const value=JSON.parse(line);if(['decrypted','extracted','integrity_checked'].includes(value.stage)&&Number.isSafeInteger(value.rss))console.log(JSON.stringify({event:'external_backup_restore_progress',stage:value.stage,rss:value.rss}));}catch{}
   }
  });
  child.on('close',code=>{
   clearTimeout(timeout);
   if(failed||code!==0)return reject(Error('Isolated restore failed'));
   try{const result=JSON.parse(output);if(result.recovery_required!==true||result.isolated_process!==true||result.external_credentials_present!==false)throw Error();resolve(result);}
   catch{reject(Error('Invalid isolated restore result'));}
  });
  // Encryption key travels only over the private pipe, never argv/env/logs.
  child.stdin.end(key);
 });
}
