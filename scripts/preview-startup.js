// Uses the production routing decisions, but never processes a message,
// moves a checkpoint, queues a real approval or writes Odoo.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { routeCommercialMessage } from '../src/commercialRouting.js';
const statePath=process.env.STATE_FILE||'/var/data/fancy-truck-state.json';
const bytes=fs.readFileSync(statePath), state=JSON.parse(bytes);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
Object.assign(process.env,{READ_ONLY:'true',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',HOST:'127.0.0.1',PORT:'0'});
const report={at:new Date().toISOString(),messages:[],errors:[],complete:true};
let app;
try{
 app=await import('../src/server.js');
 const readonlyStore={queueClassification:()=>({item:{id:'preview-only'},duplicate:false})};
 for(const account of ['hello','pietro']){
  const prefix=account.toUpperCase();
  const client=new ImapFlow({host:process.env.ARUBA_IMAP_HOST||'imaps.aruba.it',port:Number(process.env.ARUBA_IMAP_PORT||993),secure:true,auth:{user:process.env[`${prefix}_EMAIL`],pass:process.env[`${prefix}_PASSWORD`]},logger:false});
  try{
   await client.connect();await client.mailboxOpen('INBOX',{readOnly:true});
   const checkpoint=state.cursors?.[`imap:${account}:checkpoint`];
   const validity=String(client.mailbox.uidValidity);
   if(checkpoint)assert.equal(checkpoint.uidValidity,validity,'UIDVALIDITY cambiato');
   const lastUid=checkpoint?.lastUid||Number(state.cursors?.[`imap:${account}:last_uid`]||0);
   assert(lastUid>0,'Checkpoint assente: revisione manuale richiesta');
   const uids=(await client.search({uid:`${lastUid+1}:*`},{uid:true})).filter(id=>id>lastUid);
   assert(uids.length<=200,'Arretrato oltre 200: anteprima interrotta');
   if(!uids.length)continue;
   for await(const message of client.fetch(uids,{source:true},{uid:true})){
    assert(message.source.length<10*1024*1024,'Messaggio oltre 10 MB: revisione manuale');
    const parsed=await simpleParser(message.source);
    const decision=await routeCommercialMessage({parsed,uid:message.uid,account,uidValidity:validity,store:readonlyStore,findLead:app.findReplyLead});
    const row={account,uid:message.uid,from:parsed.from?.value?.[0]?.address,subject:parsed.subject,action:decision.action,kind:decision.kind,reason:decision.reason,lead_id:decision.lead?.id};
    report.messages.push(row);console.log(JSON.stringify(row));
   }
  }catch(error){report.errors.push({account,message:error.message});report.complete=false;}finally{await client.logout().catch(()=>{});}
 }
 report.stateUnchanged=hash(bytes)===hash(fs.readFileSync(statePath));assert(report.stateUnchanged,'Stato modificato');
 report.counts=report.messages.reduce((all,row)=>({...all,[row.action]:(all[row.action]||0)+1}),{});
 fs.writeFileSync('/var/data/fancy-startup-preview.json',JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify({complete:report.complete,counts:report.counts,errors:report.errors,stateUnchanged:report.stateUnchanged}));
 console.log('ANTEPRIMA: nessuna elaborazione, scrittura Odoo, approvazione o modifica dei checkpoint.');
 if(!report.complete)process.exitCode=1;
}finally{if(app)await new Promise(resolve=>app.server.close(resolve));}
