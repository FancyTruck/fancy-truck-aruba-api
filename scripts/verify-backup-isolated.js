// A separate process with an empty environment: no Odoo, SMTP, Aruba, S3 or
// application credentials, no server, no adapters and no polling timers.
import fs from 'node:fs';
import {join} from 'node:path';
import {restoreBundle} from '../src/backupBundle.js';
import {recoveryRequired} from '../src/recoveryGuard.js';
let input='';
for await(const chunk of process.stdin){input+=chunk;if(input.length>65)throw Error('Invalid key input');}
try{
 const [file,destination]=process.argv.slice(2);
 const result=await restoreBundle(file,destination,input.trim());
 input='';
 const stateFile=join(destination,'fancy-truck-state.json');
 if(!recoveryRequired(stateFile,JSON.parse(fs.readFileSync(stateFile,'utf8'))))throw Error('Recovery quarantine missing');
 process.stdout.write(JSON.stringify({...result,isolated_process:true,external_credentials_present:false}));
}catch{
 process.stderr.write('ISOLATED_RESTORE_FAILED');process.exitCode=1;
}
