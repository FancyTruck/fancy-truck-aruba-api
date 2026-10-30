import test from 'node:test';
import assert from 'node:assert/strict';
import {linkThreadMessage} from '../src/threadLinking.js';
import {pollSentMailbox} from '../src/sentTracking.js';
test('linking only writes internal notes and retry does not duplicate notes',async()=>{
 const notes=new Set();let count=0;
 const call=async(model,method,args,kwargs)=>{
  if(method==='search_read')return [];
  if(method==='search_count')return notes.has(args[0][0][2]+':'+args[0][1][2])?1:0;
  assert.equal(method,'message_post');assert.equal(kwargs.subtype_xmlid,'mail.mt_note');assert.deepEqual(kwargs.partner_ids,[]);
  notes.add(model+':'+args[0][0]);count++;return 1;
 };
 const input={parsed:{messageId:'<unique@test>',subject:'Nuovo oggetto',text:'S00331'},match:{lead:{id:503},order_ids:[331],project_ids:[20]},direction:'incoming',call,store:{audit(){}}};
 await linkThreadMessage(input);await linkThreadMessage(input);assert.equal(count,3);
});
test('native Odoo message already on the target is not copied there',async()=>{
 const result=await linkThreadMessage({parsed:{messageId:'<native@test>'},match:{lead:{id:503},order_ids:[331]},direction:'incoming',store:{audit(){}},call:async(model,method)=>{
  assert.equal(method,'search_read');return [{model:'crm.lead',res_id:503},{model:'sale.order',res_id:331}];
 }});assert(result.linked);
});
test('sent baseline is distinct from inbox and later mail is processed after restart',async()=>{
 const cursors={'imap:hello:checkpoint':{lastUid:900}};const store={cursor:k=>cursors[k],setCursor:(k,v)=>{cursors[k]=v;}};
 let released=0,processed=0;
 const client={list:async()=>[{path:'INBOX.Sent',specialUse:'\\Sent'}],mailbox:{uidValidity:12,uidNext:51},getMailboxLock:async(path,options)=>{assert(options.readOnly);return {release(){released++;}};},search:async()=>[50,51],fetchOne:async()=>({size:100,source:'message'})};
 const args={client,account:'hello',store,parse:async()=>({}),processMessage:async()=>{processed++;return {linked:true};}};
 assert((await pollSentMailbox(args)).initialized);assert.equal(processed,0);
 assert.equal((await pollSentMailbox(args)).rows.length,1);assert.equal(processed,1);
 assert.equal(cursors['imap:hello:checkpoint'].lastUid,900);assert.equal(cursors['imap:hello:sent:INBOX.Sent:checkpoint'].lastUid,51);assert.equal(released,2);
});
