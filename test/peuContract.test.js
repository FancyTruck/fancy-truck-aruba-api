import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makePeuContract} from '../src/peuContract.js';
import {hash} from '../src/peuCommon.js';
import {ApprovalService} from '../src/policy.js';
import {JsonStateStore} from '../src/store.js';
import {accessControl} from '../src/accessControl.js';
function fixture(databaseFile=':memory:'){const db=new DatabaseSync(databaseFile);const approvals=new ApprovalService(new JsonStateStore(join(mkdtempSync(join(tmpdir(),'peu-test-')),'state.json')),'test-secret');let sent=0,writes=0,fail=false;
const config={db,approvals,assertWritable(){},upstream:async()=>{writes++;return {ok:true,id:42};},verify:async()=>({ok:true,status:'verified',id:42}),smtp:async()=>{sent++;if(fail)throw new Error('uncertain');return {accepted:['test@example.invalid'],rejected:[],messageId:'mock'};}};
const contract=makePeuContract(config);
const command=(capability,parameters,key)=>{const c=contract.catalog().capabilities.find(c=>c.id===capability);return {operation_id:key,idempotency_key:key,capability,parameters,confirmation:{confirmed:true,payload_hash:hash({provider:'fancy',capability,domain:'work',payload:{parameters,catalog_hash:hash(c)},effect:c.effect,confirmation:c.confirmation})}};};
const approve=id=>{const a=approvals.approveCommand(id,'Pietro',`APPROVA ${id}`);approvals.confirm(id,'Pietro',a.confirmation_token);};
return {contract,config,command,approve,approvals,get sent(){return sent;},get writes(){return writes;},fail:()=>{fail=true;}};}
const mail={account:'pietro',to:'test@example.invalid',subject:'Simulazione',text:'Test locale'};
test('mail preparation never sends; Fancy approval mandatory',async()=>{const f=fixture(),p=await f.contract.execute(f.command('mail.prepare',mail,'prep'));assert.equal(f.sent,0);assert.equal(p.result.status,'awaiting_fancy_approval');await assert.rejects(f.contract.execute(f.command('mail.send',{action_id:p.result.action_id,payload_hash:p.result.payload_hash},'send')));assert.equal(f.sent,0);});
test('approved exact operation sends once across different keys and restart',async()=>{const f=fixture(),p=(await f.contract.execute(f.command('mail.prepare',mail,'prep'))).result;f.approve(p.action_id);const params={action_id:p.action_id,payload_hash:p.payload_hash};const r=await f.contract.execute(f.command('mail.send',params,'send'));assert.equal(r.result.status,'accepted_by_smtp');await f.contract.execute(f.command('mail.send',params,'send'));await makePeuContract(f.config).execute(f.command('mail.send',params,'send2'));assert.equal(f.sent,1);});
test('unknown SMTP outcome cannot be retried with a different key',async()=>{const f=fixture(),p=(await f.contract.execute(f.command('mail.prepare',mail,'prep'))).result;f.approve(p.action_id);f.fail();for(const key of ['a','b'])await assert.rejects(f.contract.execute(f.command('mail.send',{action_id:p.action_id,payload_hash:p.payload_hash},key)));assert.equal(f.sent,1);});
test('payload tampering after approval and idempotency collision rejected',async()=>{const f=fixture(),p=(await f.contract.execute(f.command('mail.prepare',mail,'prep'))).result;await assert.rejects(f.contract.execute(f.command('mail.prepare',{...mail,text:'Changed'},'prep')));f.approve(p.action_id);f.approvals.store.action(p.action_id).payload.to='another@example.invalid';await assert.rejects(f.contract.execute(f.command('mail.send',{action_id:p.action_id,payload_hash:p.payload_hash},'send')));assert.equal(f.sent,0);});
test('CRM executes without confirmation, verifies and deduplicates across keys and restart',async()=>{const f=fixture(),p={name:'Test',partner_id:1},cmd=f.command('crm.create',p,'direct');cmd.confirmation.confirmed=false;const r=await f.contract.execute(cmd);assert.equal(r.result.status,'verified');await makePeuContract(f.config).execute(f.command('crm.create',p,'duplicate'));assert.equal(f.writes,1);assert.equal(Object.keys(f.approvals.store.state.actions).length,0);});
test('CRM uncertain outcome cannot repeat with another key',async()=>{const f=fixture();let writes=0;const c=makePeuContract({...f.config,upstream:async()=>{writes++;throw Error('lost response');}});for(const key of ['one','two'])await assert.rejects(c.execute(f.command('crm.create',{name:'Test',partner_id:1},key)));assert.equal(writes,1);});
test('CRM recovery quarantine prevents direct writes',async()=>{const f=fixture();f.approvals.store.state.recovery={required:true};await assert.rejects(f.contract.execute(f.command('crm.create',{name:'Test',partner_id:1},'blocked')));assert.equal(f.writes,0);});
test('quotes, sends and execution remain confirmation required',async()=>{const f=fixture();for(const name of ['quote.prepare','mail.send','operation.execute'])assert.equal(f.contract.catalog().capabilities.find(c=>c.id===name).confirmation,true);const c=f.command('quote.prepare',{partner_id:1,lines:[{product_id:1,name:'Test',quantity:1,price_unit:10}],order_type:'sale'},'quote');c.confirmation.confirmed=false;await assert.rejects(f.contract.execute(c));assert.equal(f.writes,0);});
test('incorrect confirmation rejected',async()=>{const f=fixture(),c=f.command('mail.prepare',mail,'prep');c.confirmation.payload_hash='bad';await assert.rejects(f.contract.execute(c));assert.equal(f.sent,0);});
test('ledger survives database close/reopen and interrupted effects become unknown',async()=>{const file=join(mkdtempSync(join(tmpdir(),'peu-ledger-')),'ledger.sqlite'),f=fixture(file),p=(await f.contract.execute(f.command('mail.prepare',mail,'prep'))).result;f.approve(p.action_id);const params={action_id:p.action_id,payload_hash:p.payload_hash};await f.contract.execute(f.command('mail.send',params,'send'));f.config.db.prepare("INSERT INTO peu_effects VALUES('interrupted','hash','executing',NULL)").run();f.config.db.close();const db=new DatabaseSync(file),restarted=makePeuContract({...f.config,db});await restarted.execute(f.command('mail.send',params,'new-request'));assert.equal(f.sent,1);assert.equal(db.prepare("SELECT status FROM peu_effects WHERE action_id='interrupted'").get().status,'unknown');db.close();});
test('Peu token permits both inboxes and denies admin, approvals and direct sending',()=>{const middleware=accessControl({PEU_ACCESS_TOKEN:'scoped'});for(const [method,url,expected] of [['GET','/v1/peu/aruba/pietro/folders',200],['POST','/v1/peu/commands',200],['GET','/v1/peu/aruba/hello/folders',200],['GET','/v1/diagnostics',403],['POST','/v1/approvals/a/confirm',403],['POST','/v1/pietro/send',403],['POST','/v1/actions/a/execute',403]]){let status=200;middleware({method,originalUrl:url,headers:{authorization:'Bearer scoped'}},{status(s){status=s;return this;},json(){}},()=>{});assert.equal(status,expected);}});

function review(f,key='review',extra={}) {return f.approvals.store.queueClassification({source_key:key,account:'hello',sender:'service@example.invalid',subject:'Account notification',excerpt:'Untrusted message',reason:'commercial_intent_not_established',...extra}).item;}
async function snapshot(f,row){return (await f.contract.execute(f.command('reviews.get',{review_id:row.id},'get-'+row.id))).result.item.snapshot_hash;}
test('review listing is bounded, exposes no routing internals and creates no business effects',async()=>{
 const f=fixture();review(f,'a');review(f,'b');
 const first=(await f.contract.execute(f.command('reviews.list',{limit:1},'list'))).result;
 assert.equal(first.total,2);assert.equal(first.items.length,1);assert(first.next_after_id);
 const next=(await f.contract.execute(f.command('reviews.list',{limit:1,after_id:first.next_after_id},'next'))).result;
 assert.equal(next.items.length,1);assert.notEqual(first.items[0].id,next.items[0].id);assert.equal(next.next_after_id,null);
 assert.equal('source_key' in first.items[0],false);assert.equal(f.writes,0);assert.equal(f.sent,0);assert.equal(Object.keys(f.approvals.store.state.actions).length,0);
});
test('confirmed exact review closes once, replay works after contract restart',async()=>{
 const f=fixture(),row=review(f),p={review_id:row.id,snapshot_hash:await snapshot(f,row),resolution:'NOT_COMMERCIAL',note:'Notifica di servizio non commerciale'};
 const cmd=f.command('reviews.resolve',p,'close');const result=await f.contract.execute(cmd);
 assert.equal(result.result.status,'resolved');assert.equal(f.approvals.store.state.classification_reviews[row.id].resolved_by_role,'peu_owner');
 assert.deepEqual(await makePeuContract(f.config).execute(cmd),result);
 await assert.rejects(f.contract.execute(f.command('reviews.resolve',p,'close-again')),e=>e.code==='review_already_closed');
 assert.equal(f.writes,0);assert.equal(f.sent,0);assert.equal(Object.keys(f.approvals.store.state.actions).length,0);
});
test('review close executes exact request directly and never accepts a chosen actor',async()=>{
 const f=fixture(),r=review(f),p={review_id:r.id,snapshot_hash:await snapshot(f,r),resolution:'NOT_COMMERCIAL',note:'Non pertinente alle richieste'};
 const c=f.command('reviews.resolve',p,'close');c.confirmation.confirmed=false;
 await assert.rejects(f.contract.execute(f.command('reviews.resolve',{...p,actor:'admin'},'spoof')));
 await f.contract.execute(c);assert.equal(f.approvals.store.state.classification_reviews[r.id].status,'RESOLVED');
});
test('changed review and an altered command cannot close a different case',async()=>{
 const f=fixture(),r=review(f),other=review(f,'other'),p={review_id:r.id,snapshot_hash:await snapshot(f,r),resolution:'NOT_COMMERCIAL',note:'Non pertinente alle richieste'};
 r.excerpt='Changed since read';await assert.rejects(f.contract.execute(f.command('reviews.resolve',p,'stale')),e=>e.code==='review_changed_reconfirm');
 const c=f.command('reviews.resolve',p,'tampered');c.parameters={...p,review_id:other.id};await assert.rejects(f.contract.execute(c),e=>e.code==='exact_confirmation_required');
 assert.equal(r.status,'DA_CLASSIFICARE');assert.equal(other.status,'DA_CLASSIFICARE');
});
test('interrupted operations cannot be dismissed or reconciled through Peu',async()=>{
 const f=fixture(),r=review(f,'uncertain',{operation_id:'unfinished'});
 const detail=(await f.contract.execute(f.command('reviews.get',{review_id:r.id},'details'))).result.item;
 assert.deepEqual(detail.allowed_resolutions,[]);
 for(const resolution of ['NOT_COMMERCIAL','HANDLED_MANUALLY'])await assert.rejects(f.contract.execute(f.command('reviews.resolve',{review_id:r.id,snapshot_hash:detail.snapshot_hash,resolution,note:'Controllo generico via voce'},resolution)),e=>e.code==='manual_reconciliation_required');
 assert.equal(r.status,'DA_CLASSIFICARE');
});
test('read-only and restore quarantine block review closure',async()=>{
 for(const mode of ['readOnly','recovery']){
 const f=fixture(),r=review(f),p={review_id:r.id,snapshot_hash:await snapshot(f,r),resolution:'NOT_COMMERCIAL',note:'Notifica di servizio non commerciale'};
 if(mode==='recovery')f.approvals.store.state.recovery={required:true};
 else f.config.assertWritable=()=>{throw Object.assign(new Error('read_only'),{status:403,code:'read_only'});};
 await assert.rejects(makePeuContract(f.config).execute(f.command('reviews.resolve',p,mode)));
 assert.equal(r.status,'DA_CLASSIFICARE');
 }
});
test('failed persistence leaves the review open and no successful receipt',async()=>{
 const f=fixture(),r=review(f),p={review_id:r.id,snapshot_hash:await snapshot(f,r),resolution:'NOT_COMMERCIAL',note:'Notifica di servizio non commerciale'};
 f.approvals.store.save=()=>{throw Error('disk failure');};
 await assert.rejects(f.contract.execute(f.command('reviews.resolve',p,'failure')),e=>e.code==='review_persistence_failed');
 assert.equal(f.approvals.store.state.classification_reviews[r.id].status,'DA_CLASSIFICARE');assert.equal(f.contract.status('failure').status,'unknown');
});
test('reader and reviewer credentials cannot invoke Peu commands',()=>{
 const middleware=accessControl({REVIEW_READ_TOKEN:'read',REVIEW_WRITE_TOKEN:'write',PEU_ACCESS_TOKEN:'owner-bridge'});
 for(const token of ['read','write','invalid']){
 let status=200;middleware({method:'POST',originalUrl:'/v1/peu/commands',headers:{authorization:'Bearer '+token}},{status(s){status=s;return this;},json(){}},()=>{});assert.equal(status,token==='invalid'?401:403);
 }
});



test('owner confirmed mail bridge approves exact draft, sends once and survives replay',async()=>{const f=fixture(),p=(await f.contract.execute(f.command('mail.prepare',{...mail},'draft'))).result;const params={action_id:p.action_id,payload_hash:p.payload_hash};const missing=f.command('mail.confirm_send',params,'no-confirm');missing.confirmation.confirmed=false;await assert.rejects(f.contract.execute(missing),e=>e.code==='exact_confirmation_required');assert.equal(f.sent,0);const result=await f.contract.execute(f.command('mail.confirm_send',params,'confirm'));assert.equal(result.result.status,'accepted_by_smtp');await makePeuContract(f.config).execute(f.command('mail.confirm_send',params,'replay'));assert.equal(f.sent,1);assert.equal(f.approvals.store.action(p.action_id).status,'EXECUTED');});
test('bridge rejects modified drafts, other account and non-mail actions',async()=>{for(const mutation of [a=>a.payload.to='other@example.invalid',a=>a.payload.account='hello',a=>a.type='MAKE_PAYMENT']){const f=fixture(),p=(await f.contract.execute(f.command('mail.prepare',{...mail},'draft'))).result;mutation(f.approvals.store.action(p.action_id));await assert.rejects(f.contract.execute(f.command('mail.confirm_send',{action_id:p.action_id,payload_hash:p.payload_hash},'send')));assert.equal(f.sent,0);}});
test('bridge never repeats uncertain SMTP outcome with a different key',async()=>{const f=fixture(),p=(await f.contract.execute(f.command('mail.prepare',{...mail},'draft'))).result;f.fail();for(const key of ['one','two'])await assert.rejects(f.contract.execute(f.command('mail.confirm_send',{action_id:p.action_id,payload_hash:p.payload_hash},key)));assert.equal(f.sent,1);});
test('bridge preserves recovery quarantine and unfinished final confirmation',async()=>{for(const blocked of ['recovery','interrupted']){const f=fixture(),p=(await f.contract.execute(f.command('mail.prepare',{...mail},'draft'))).result;if(blocked==='recovery')f.approvals.store.state.recovery={required:true};else f.approvals.approveCommand(p.action_id,'Pietro','APPROVA '+p.action_id);await assert.rejects(f.contract.execute(f.command('mail.confirm_send',{action_id:p.action_id,payload_hash:p.payload_hash},'send')));assert.equal(f.sent,0);}});

test('both mailboxes require exact approval and preserve sender on replay',async()=>{
 for(const account of ['hello','pietro']){
  const f=fixture(),p=(await f.contract.execute(f.command('mail.prepare',{...mail,account},'draft'))).result;
  assert.equal(f.sent,0);assert.equal(f.approvals.store.action(p.action_id).payload.account,account);
  const command=f.command('mail.confirm_send',{action_id:p.action_id,payload_hash:p.payload_hash},'confirm');
  command.confirmation.confirmed=false;
  await assert.rejects(f.contract.execute(command));assert.equal(f.sent,0);
  command.confirmation.confirmed=true;await f.contract.execute(command);
  await f.contract.execute({...command,idempotency_key:'replay'});assert.equal(f.sent,1);
 }
});
test('unknown mailbox cannot be prepared',async()=>{
 const f=fixture();await assert.rejects(f.contract.execute(f.command('mail.prepare',{...mail,account:'other'},'bad')));assert.equal(f.sent,0);
});

test('automatic drafts are readable without approval and require exact owner confirmation to send',async()=>{const f=fixture();const a=f.approvals.queue({type:'SEND_EMAIL',target:mail.to,idempotency_key:'automatic',payload:{account:'hello',subject:mail.subject,text:mail.text}}).action;const r=await f.contract.execute(f.command('mail.drafts',{since:'2000-01-01T00:00:00.000Z',action_id:a.id},'read'));assert.equal(r.result.drafts[0].action_id,a.id);assert.equal(r.result.drafts[0].to,mail.to);assert.equal(f.sent,0);const params={action_id:a.id,payload_hash:r.result.drafts[0].payload_hash};const no=f.command('mail.confirm_send',params,'no');no.confirmation.confirmed=false;await assert.rejects(f.contract.execute(no));assert.equal(f.sent,0);await assert.rejects(f.contract.execute(f.command('mail.confirm_send',{...params,payload_hash:'changed'},'changed')));assert.equal(f.sent,0);await f.contract.execute(f.command('mail.confirm_send',params,'yes'));await f.contract.execute(f.command('mail.confirm_send',params,'replay'));assert.equal(f.sent,1);});

test('delete draft cancels only the exact pending action and prevents later sending',async()=>{
 const f=fixture();const p=(await f.contract.execute(f.command('mail.prepare',mail,'draft'))).result;
 const other=(await f.contract.execute(f.command('mail.prepare',{...mail,subject:'Other'},'other'))).result;
 const params={action_id:p.action_id,payload_hash:p.payload_hash};
 await assert.rejects(f.contract.execute(f.command('mail.delete_draft',{...params,payload_hash:'0'.repeat(64)},'stale')));
 const cmd=f.command('mail.delete_draft',params,'delete');cmd.confirmation.confirmed=false;
 assert.equal((await f.contract.execute(cmd)).result.status,'draft_deleted');
 await makePeuContract(f.config).execute(cmd);
 assert.equal(f.approvals.store.action(other.action_id).status,'PENDING_APPROVAL');
 assert.equal(f.approvals.store.action(p.action_id).status,'CANCELLED');
 await assert.rejects(f.contract.execute(f.command('mail.confirm_send',params,'later-confirm')));
 assert.equal(f.sent,0);assert.equal(f.writes,0);
});
test('draft original uses exact message ID, account and inbox, never a subject match',async()=>{
 const f=fixture();const p=(await f.contract.execute(f.command('mail.prepare',{...mail,inReplyTo:'<customer-one>'},'draft'))).result;
 const args={since:'2000-01-01T00:00:00.000Z',action_id:p.action_id};
 const content={text:'Original customer request',subject:'Same subject',from:[{address:mail.to}]};
 for(const [i,original] of [null,{message_id:'<other>',folder:'INBOX',payload:content},{message_id:'<customer-one>',folder:'Sent',payload:content},{message_id:'<customer-one>',folder:'INBOX',payload:content}].entries()){
 const contract=makePeuContract({...f.config,readOriginal:async(account,id)=>{assert.equal(account,'pietro');assert.equal(id,'<customer-one>');return {original};}});
 const draft=(await contract.execute(f.command('mail.drafts',args,'read-original-'+i))).result.drafts[0];
 assert.equal(draft.original_status,i===3?'verified':'unavailable');assert.equal(!!draft.original,i===3);
 }
});

test('snoozed reviews leave the queue and changed snapshots cannot be reused',async()=>{
 const f=fixture(),row=review(f,'snooze'),before=await snapshot(f,row),until=new Date(Date.now()+86400000).toISOString();
 const result=(await f.contract.execute(f.command('reviews.snooze',{review_id:row.id,snapshot_hash:before,until},'snooze'))).result;
 assert.equal(result.status,'snoozed');assert.equal(result.item.snoozed_until,until);
 assert.equal((await f.contract.execute(f.command('reviews.list',{},'list-snoozed'))).result.total,0);
 await assert.rejects(f.contract.execute(f.command('reviews.resolve',{review_id:row.id,snapshot_hash:before,resolution:'NOT_COMMERCIAL',note:'Classificazione precedente ormai superata.'},'stale-close')));
 const fresh=(await f.contract.execute(f.command('reviews.get',{review_id:row.id},'fresh-snooze'))).result.item;
 await f.contract.execute(f.command('reviews.resolve',{review_id:row.id,snapshot_hash:fresh.snapshot_hash,resolution:'HANDLED_MANUALLY',note:'Il team ha già risposto al cliente.'},'close-snoozed'));
 assert.equal(f.sent,0);assert.equal(f.writes,0);
});
test('review detail recovers only its exact original and keeps mailbox/message identity',async()=>{
 const f=fixture(),row=review(f,'original-review',{account:'pietro',message_id:'<original>'});let reads=0;
 f.config.readOriginal=async(account,id)=>{reads++;assert.equal(account,'pietro');assert.equal(id,'<original>');return {original:{message_id:id,folder:'INBOX',payload:{text:'Full original',from:[{address:row.sender}]}}};};
 const contract=makePeuContract(f.config),result=(await contract.execute(f.command('reviews.get',{review_id:row.id},'get-original'))).result.item;
 assert.equal(result.original_status,'verified');assert.equal(result.original.text,'Full original');assert.equal(reads,1);assert.equal(f.sent,0);
});
