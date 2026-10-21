// Read-only evidence for the controlled startup. Does not move checkpoints,
// approve actions, process messages, send mail, or change Odoo records.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
const path=process.env.STATE_FILE||'/var/data/fancy-truck-state.json';
const before=fs.readFileSync(path), state=JSON.parse(before);
const report={at:new Date().toISOString(),readOnly:process.env.READ_ONLY!=='false',automationEnabled:process.env.AUTOMATION_ENABLED==='true',
  credentialsConfigured:Object.fromEntries(['OPENAI_API_KEY','OPENAI_MODEL','GOOGLE_MAPS_API_KEY','ORS_API_KEY','MAPBOX_ACCESS_TOKEN'].map(key=>[key,Boolean(process.env[key])])),
  actions:{},uncertainMailOperations:0,mailboxes:[],errors:[]};
for(const action of Object.values(state.actions||{}))report.actions[action.status]=(report.actions[action.status]||0)+1;
report.uncertainMailOperations=Object.values(state.mail_operations||{}).filter(op=>op.status!=='COMPLETED').length;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const api=async(model,method,body)=>{
  assert(['search_read','search_count'].includes(method));
  const r=await fetch(`${process.env.ODOO_URL.replace(/\/$/,'')}/json/2/${model}/${method}`,{method:'POST',
    headers:{authorization:`bearer ${process.env.ODOO_API_KEY}`,'x-odoo-database':process.env.ODOO_DB,'content-type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error(`${model}: HTTP ${r.status}`);return r.json();
};
for(const account of ['hello','pietro']){
  const prefix=account.toUpperCase();
  const client=new ImapFlow({host:process.env.ARUBA_IMAP_HOST||'imaps.aruba.it',port:Number(process.env.ARUBA_IMAP_PORT||993),secure:true,
    auth:{user:process.env[`${prefix}_EMAIL`],pass:process.env[`${prefix}_PASSWORD`]},logger:false});
  try{
    await client.connect();await client.mailboxOpen('INBOX',{readOnly:true});
    const stored=state.cursors?.[`imap:${account}:checkpoint`];
    const effective=stored||{uidValidity:String(client.mailbox.uidValidity),lastUid:Number(state.cursors?.[`imap:${account}:last_uid`]||0),initialSince:new Date(Date.now()-86400000).toISOString()};
    const validityMatches=effective.uidValidity===String(client.mailbox.uidValidity);
    const query=effective.lastUid>0?{uid:`${effective.lastUid+1}:*`}:{since:new Date(effective.initialSince)};
    const pending=validityMatches?(await client.search(query,{uid:true})).filter(uid=>uid>effective.lastUid):null;
    report.mailboxes.push({account,storedCheckpoint:stored||null,effectiveCheckpoint:effective,uidValidity:String(client.mailbox.uidValidity),
      uidNext:client.mailbox.uidNext,validityMatches,pendingCount:pending?.length??null,firstPendingUids:pending?.slice(0,10)||[],
      freshCheckpointWouldUse24Hours:!stored&&!effective.lastUid});
  }catch(e){report.errors.push(`${account}: ${e.message}`);}finally{await client.logout().catch(()=>{});}
}
try{
  const checkpoint=state.cursors?.['odoo:crm:messages:checkpoint']||{lastId:0,since:new Date(Date.now()-1800000).toISOString().replace('T',' ').slice(0,19)};
  const base=[['model','=','crm.lead'],['message_type','=','email']];
  const domain=[...base,...(checkpoint.lastId?[['id','>',checkpoint.lastId]]:[['date','>=',checkpoint.since]])];
  const count=await api('mail.message','search_count',{domain});
  const latest=await api('mail.message','search_read',{domain:base,fields:['id','date'],order:'id desc',limit:1});
  report.odoo={storedCheckpoint:state.cursors?.['odoo:crm:messages:checkpoint']||null,effectiveCheckpoint:checkpoint,pendingCount:count,latest:latest[0]||null};
}catch(e){report.errors.push(`Odoo: ${e.message}`);}
const nativePath='/var/data/fancy-native-logistics-test.json';
if(fs.existsSync(nativePath)){
  const probe=JSON.parse(fs.readFileSync(nativePath));
  report.nativeTest={status:probe.status,scenarios:probe.scenarios?.map(item=>({name:item.name,status:item.status,orderId:item.order_id}))};
}
report.stateUnchanged=digest(before)===digest(fs.readFileSync(path));
report.readyForDecision=report.readOnly&&!report.automationEnabled&&report.stateUnchanged&&!report.errors.length&&report.mailboxes.every(box=>box.validityMatches);
fs.writeFileSync('/var/data/fancy-startup-audit.json',JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify(report,null,2));
console.log('AUDIT SOLA LETTURA: nessun messaggio elaborato, nessun checkpoint spostato, nessuna approvazione eseguita.');
if(!report.readyForDecision)process.exitCode=1;
