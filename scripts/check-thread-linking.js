// Scoped live test: internal notes on the existing test case only, no email sends.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
const path='/var/data/fancy-thread-linking-test.json';
assert(!fs.existsSync(path),'Collaudo già eseguito: leggere il report, non ripetere');
Object.assign(process.env,{APP_ENV:'test',READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',HOST:'127.0.0.1',PORT:'0',STATE_FILE:'/var/data/fancy-thread-linking-test-state.json'});
nodemailer.createTransport=()=>{throw Error('Invii vietati nel collaudo');};
const original=globalThis.fetch;const allowed=new Map([['crm.lead',[503]],['sale.order',[331]]]);
let writes=0;
globalThis.fetch=async(url,options)=>{
 assert.equal(new URL(url).origin,new URL(process.env.ODOO_URL).origin);
 const [model,method]=new URL(url).pathname.split('/').slice(-2);const body=JSON.parse(options.body);
 if(!['search_read','search_count'].includes(method)){
  assert.equal(method,'message_post');assert.equal(body.subtype_xmlid,'mail.mt_note');assert.deepEqual(body.partner_ids,[]);
  assert(body.ids.length&&body.ids.every(id=>allowed.get(model)?.includes(id)));writes++;
 }
 return original(url,options);
};
let app;
try{
 app=await import('../src/server.js');
 const customer='grafichefancytruck@gmail.com';
 const parsed={subject:'Aggiornamento logistico S00331',text:'Collaudo collegamento: comunicazione relativa al preventivo S00331.',messageId:'<fancy-thread-in-20261021@fancytruck.it>',from:{value:[{address:customer}]},to:{value:[{address:process.env.HELLO_EMAIL}]}};
 const match=await app.findReplyLead(customer,parsed.subject,parsed);
 assert.equal(match.lead?.id,503);assert.deepEqual(match.order_ids,[331]);
 allowed.set('project.project',match.project_ids||[]);
 const incoming=await app.processQuoteRequest(parsed,1,'hello','thread-test');assert(incoming.linked);
 const outgoing=await app.processSentMessage({...parsed,messageId:'<fancy-thread-out-20261021@fancytruck.it>',from:parsed.to,to:parsed.from},2,'hello','thread-test','Sent');assert(outgoing.linked);
 const before=writes;await app.processQuoteRequest(parsed,1,'hello','thread-test');assert.equal(writes,before,'Replay ha duplicato le note');
 assert.equal(Object.keys(app.store.state.actions).length,0,'Non deve creare risposte da inviare');
 const report={at:new Date().toISOString(),status:'PASSED',incoming,outgoing,internalNoteWrites:writes,replayWrites:0,sends:0,quotesCreated:0};
 fs.writeFileSync(path,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}finally{if(app)await new Promise(r=>app.server.close(r));}
