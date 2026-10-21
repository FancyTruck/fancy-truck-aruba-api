// One-time user-authorized cancellation and exclusion of the reviewed backlog.
// Never deletes mail or Odoo records, never sends messages or starts the server.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
const statePath=process.env.STATE_FILE||'/var/data/fancy-truck-state.json';
const marker='START_FROM_REVIEWED_CUTOFF_20261021';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(process.env.READ_ONLY,'true','Il servizio deve essere in sola lettura');
assert.equal(process.env.AUTOMATION_ENABLED,'false','Disattivare prima il ciclo automatico');
const bytes=fs.readFileSync(statePath),state=JSON.parse(bytes);
assert(!state.idempotency?.[marker],'Avvio già preparato: non ripetere');
const pending=Object.values(state.actions).filter(a=>a.status==='PENDING_APPROVAL');
assert.equal(pending.length,330,'La coda è cambiata: ricontrollare');
assert(Object.values(state.actions).every(a=>['PENDING_APPROVAL','CANCELLED','EXECUTED'].includes(a.status)),'Azioni in corso');
assert(Object.values(state.mail_operations||{}).every(op=>op.status==='COMPLETED'),'Operazioni incerte');
const preview=JSON.parse(fs.readFileSync('/var/data/fancy-startup-preview.json'));
assert(preview.complete&&preview.stateUnchanged&&!preview.errors.length,'Anteprima incompleta');
assert.equal(preview.messages.length,27);
const at=new Date().toISOString();
const cutoffs=[{account:'hello',validity:'1724263363',before:3693,last:3713,count:20},
 {account:'pietro',validity:'1754596100',before:4313,last:4321,count:7}];
for(const box of cutoffs){
 const checkpoint=state.cursors?.[`imap:${box.account}:checkpoint`];
 assert.equal(checkpoint?.lastUid??Number(state.cursors?.[`imap:${box.account}:last_uid`]||0),box.before,'Checkpoint cambiato');
 if(checkpoint)assert.equal(checkpoint.uidValidity,box.validity);
 const rows=preview.messages.filter(m=>m.account===box.account);
 assert.equal(new Set(rows.map(m=>m.uid)).size,box.count);
 assert(rows.every(m=>m.uid>box.before&&m.uid<=box.last));
 assert.equal(Math.max(...rows.map(m=>m.uid)),box.last);
 const prefix=box.account.toUpperCase();
 const client=new ImapFlow({host:process.env.ARUBA_IMAP_HOST||'imaps.aruba.it',port:Number(process.env.ARUBA_IMAP_PORT||993),secure:true,
  auth:{user:process.env[`${prefix}_EMAIL`],pass:process.env[`${prefix}_PASSWORD`]},logger:false});
 try{await client.connect();await client.mailboxOpen('INBOX',{readOnly:true});
  assert.equal(String(client.mailbox.uidValidity),box.validity,'Casella cambiata');
 }finally{await client.logout().catch(()=>{});}
 state.cursors[`imap:${box.account}:checkpoint`]={uidValidity:box.validity,lastUid:box.last,initialSince:at};
 state.cursors[`imap:${box.account}:last_uid`]=box.last;
}
// Preserve every Odoo email newer than the last inspected record, even if old-dated.
assert(!state.cursors['odoo:crm:messages:checkpoint'],'Checkpoint Odoo cambiato');
const audit=JSON.parse(fs.readFileSync('/var/data/fancy-startup-audit.json'));
assert(audit.readyForDecision&&audit.odoo.latest.id===2865&&audit.odoo.pendingCount===0,'Audit Odoo differente');
state.cursors['odoo:crm:messages:checkpoint']={lastId:2865,since:at.replace('T',' ').slice(0,19)};
for(const action of pending)Object.assign(action,{status:'CANCELLED',cancelled_at:at,cancel_reason:marker});
const result={at,cancelled:pending.length,excludedEmails:27,cutoffs,odooLastId:2865,sends:0};
state.idempotency??={};state.idempotency[marker]={at,result};
state.events.push({id:crypto.randomUUID(),at,type:marker,...result});
assert.equal(hash(fs.readFileSync(statePath)),hash(bytes),'Stato cambiato durante il controllo');
const backup=`${statePath}.before-fresh-start-${Date.now()}`;
fs.writeFileSync(backup,bytes,{mode:0o600,flag:'wx'});
assert.equal(hash(fs.readFileSync(backup)),hash(bytes));
const temporary=`${statePath}.fresh-start-${process.pid}.tmp`;
fs.writeFileSync(temporary,JSON.stringify(state,null,2),{mode:0o600,flag:'wx'});
assert.equal(hash(fs.readFileSync(statePath)),hash(bytes),'Stato cambiato: nessuna sostituzione');
fs.renameSync(temporary,statePath);
const verified=JSON.parse(fs.readFileSync(statePath));
assert.equal(Object.values(verified.actions).filter(a=>a.status==='PENDING_APPROVAL').length,0);
assert(verified.idempotency[marker]);
console.log(JSON.stringify({...result,backup,sha256:hash(bytes)}));
console.log('AVVIO PREPARATO: riavviare il servizio prima di attivare i cicli. Email successive ai 27 messaggi conservate per elaborazione.');
