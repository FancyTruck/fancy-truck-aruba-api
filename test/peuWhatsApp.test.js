import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PeuWhatsAppGateway} from '../src/peuWhatsApp.js';
function fixture(options={}) {
 const db=new DatabaseSync(':memory:'), calls=[];
 const data={
 'whatsapp.message':[{id:4,msg_uid:'test-provider',mail_message_id:[11360],create_date:'2026-10-22 09:58:02'}],
 'mail.message':[{id:11360,model:'discuss.channel',res_id:34,body:'<p>Test Peu</p>',attachment_ids:[]}],
 'discuss.channel':[{id:34,channel_type:'whatsapp',wa_account_id:[2],whatsapp_number:'393330000000',whatsapp_partner_id:[1],channel_member_ids:[70,71],whatsapp_channel_valid_until:'2026-10-23 09:58:02'}],
 'res.users':[{id:2,partner_id:[3],active:true}],
 'discuss.channel.member':[{id:70,partner_id:[1]},{id:71,partner_id:[3]}]};
 const env={PEU_WHATSAPP_ODOO_ENABLED:'true',PEU_WHATSAPP_OWNER:'+393330000000',PEU_WHATSAPP_ACCOUNT_ID:'2',PEU_WHATSAPP_OPERATOR_ID:'2',PEU_WHATSAPP_SINCE:'2026-10-22T09:00:00Z',PEU_WHATSAPP_REPLY_VERIFIED:'true',...options.env};
 const gateway=new PeuWhatsAppGateway({db,env,now:()=>Date.parse('2026-10-22T10:00:00Z'),parse:async()=>({text:'Test Peu'}),assertWritable:()=>{if(options.readOnly)throw Error('readonly')},call:async(m,method,args,kwargs)=>{calls.push({m,method,args,kwargs});if(method==='message_post'){if(options.failSend)throw Error('timeout');return 12000;}if(m==='whatsapp.message'&&args[0].some(d=>d[0]==='mail_message_id'))return [{id:5,state:'delivered',msg_uid:'outbound-test'}];return data[m];}});
 return {db,data,calls,gateway};
}
const reply={id:4,event_id:'odoo:2:test-provider',text:'Risposta di prova'};
test('verified source and exact owner query',async()=>{const f=fixture();const s=await f.gateway.source(4);assert.equal(s.text,'Test Peu');assert.deepEqual(f.calls[0].args[0].find(x=>x[0]==='mobile_number'),['mobile_number','in',['393330000000','+393330000000']]);f.db.close()});
for(const [name,change] of Object.entries({otherNumber:f=>f.data['discuss.channel'][0].whatsapp_number='393331111111',otherAccount:f=>f.data['discuss.channel'][0].wa_account_id=[3],extraMember:f=>f.data['discuss.channel.member'][1].partner_id=[99],badDate:f=>f.data['whatsapp.message'][0].create_date='invalid',badWindow:f=>f.data['discuss.channel'][0].whatsapp_channel_valid_until=false,inactiveOperator:f=>f.data['res.users'][0].active=false,wrongModel:f=>f.data['mail.message'][0].model='crm.lead'}))test('reject '+name,async()=>{const f=fixture();change(f);await assert.rejects(f.gateway.reply(reply));assert.equal(f.calls.filter(x=>x.method==='message_post').length,0);f.db.close()});
test('duplicates and changed payload',async()=>{const f=fixture();assert.equal((await f.gateway.reply(reply)).status,'delivered');await f.gateway.reply(reply);await assert.rejects(f.gateway.reply({...reply,text:'Alterata'}),/reply_content_changed/);assert.equal(f.calls.filter(x=>x.method==='message_post').length,1);f.db.close()});
test('concurrent duplicate sends once',async()=>{const f=fixture();await Promise.all([f.gateway.reply(reply),f.gateway.reply(reply)]);assert.equal(f.calls.filter(x=>x.method==='message_post').length,1);f.db.close()});
test('lost outcome never repeats write',async()=>{const f=fixture({failSend:true});await assert.rejects(f.gateway.reply(reply),/reply_outcome_unknown/);assert.equal((await f.gateway.reply(reply)).status,'unknown');assert.equal(f.calls.filter(x=>x.method==='message_post').length,1);f.db.close()});
for(const options of [{readOnly:true},{env:{PEU_WHATSAPP_REPLY_VERIFIED:'false'}},{env:{PEU_WHATSAPP_ODOO_ENABLED:'false'}}])test('existing or activation guard prevents send '+JSON.stringify(options),async()=>{const f=fixture(options);await assert.rejects(f.gateway.reply(reply));assert.equal(f.calls.filter(x=>x.method==='message_post').length,0);f.db.close()});
test('attachments not interpreted as commands',async()=>{const f=fixture();f.data['mail.message'][0].attachment_ids=[88];const s=await f.gateway.source(4);assert.equal(s.text,null);assert.equal(s.unsupported_attachment,true);f.db.close()});
