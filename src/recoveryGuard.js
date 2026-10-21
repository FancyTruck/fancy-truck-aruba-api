import fs from 'node:fs';
import {dirname,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export function recoveryRequired(stateFile,state){
 if(state?.recovery?.required!==undefined&&state.recovery.required!==false)return true;
 if(fs.existsSync(join(dirname(stateFile),'RECOVERY_REQUIRED.json')))return true;
 const file=join(dirname(stateFile),'peu-aruba.sqlite');
 if(!fs.existsSync(file))return false;
 const db=new DatabaseSync(file,{readOnly:true});
 try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='peu_recovery'").get()&&db.prepare('SELECT 1 FROM peu_recovery WHERE required!=0 LIMIT 1').get());}
 finally{db.close();}
}
export function applyRecoveryGuard(config,state){
 return recoveryRequired(config.stateFile,state)?Object.freeze({...config,readOnly:true,automationEnabled:false,recoveryRequired:true}):config;
}
