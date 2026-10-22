import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const rid=x=>Array.isArray(x)?x[0]:x;
const phone=x=>typeof x==='string'?x.replace(/[ +()-]/g,''):'';
const error=(code,status=409)=>Object.assign(new Error(code),{code,status});
const utc=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x)?Date.parse(x.replace(' ','T')+'Z'):NaN;
export class PeuWhatsAppGateway {
 constructor({db,call,parse,assertWritable,env=process.env,now=()=>Date.now()}){
  Object.assign(this,{db,call,parse,assertWritable,env,now});
  db.exec('CREATE TABLE IF NOT EXISTS peu_whatsapp_replies(event_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, status TEXT NOT NULL, mail_id INTEGER, provider_id TEXT, updated_at TEXT NOT NULL)');
 }
 config(){
  const e=this.env,owner=e.PEU_WHATSAPP_OWNER,account=Number(e.PEU_WHATSAPP_ACCOUNT_ID),operator=Number(e.PEU_WHATSAPP_OPERATOR_ID),since=Date.parse(e.PEU_WHATSAPP_SINCE);
  if(e.PEU_WHATSAPP_ODOO_ENABLED!=='true')throw error('whatsapp_odoo_disabled',503);
  if(!/^\+?[1-9]\d{7,14}$/.test(owner||'')||!Number.isSafeInteger(account)||account<=0||!Number.isSafeInteger(operator)||operator<=0||!Number.isFinite(since))throw error('whatsapp_odoo_unconfigured',503);
  return {owner:phone(owner),account,operator,since};
 }
 async read(model,domain,fields,extra={}){const rows=await this.call(model,'search_read',[domain],{fields,limit:1,...extra});if(!Array.isArray(rows))throw error('invalid_odoo_response',502);return rows;}
 async source(recordId){
  const c=this.config();
  const rows=await this.read('whatsapp.message',[['id','=',recordId],['wa_account_id','=',c.account],['state','=','received'],['message_type','=','inbound'],['mobile_number','in',[c.owner,'+'+c.owner]]],['id','msg_uid','mail_message_id','create_date']);
  const wa=rows[0];if(rows.length!==1||!wa.msg_uid||!rid(wa.mail_message_id)||!Number.isFinite(utc(wa.create_date))||utc(wa.create_date)<Math.max(c.since,this.now()-86400000)||utc(wa.create_date)>this.now())throw error('owner_message_unavailable',403);
  const mail=(await this.read('mail.message',[['id','=',rid(wa.mail_message_id)]],['id','model','res_id','body','attachment_ids']))[0];
  if(!mail||mail.model!=='discuss.channel'||!mail.res_id)throw error('invalid_whatsapp_channel',403);
  const channel=(await this.read('discuss.channel',[['id','=',mail.res_id]],['id','channel_type','wa_account_id','whatsapp_number','whatsapp_partner_id','channel_member_ids','whatsapp_channel_valid_until']))[0];
  if(!channel||channel.channel_type!=='whatsapp'||rid(channel.wa_account_id)!==c.account||phone(channel.whatsapp_number)!==c.owner||!Number.isFinite(utc(channel.whatsapp_channel_valid_until))||utc(channel.whatsapp_channel_valid_until)<=this.now())throw error('whatsapp_channel_not_authorized',403);
  const operator=(await this.read('res.users',[['id','=',c.operator]],['id','partner_id','active']))[0];
  if(!operator?.active||!rid(operator.partner_id)||!rid(channel.whatsapp_partner_id)||!channel.channel_member_ids?.length)throw error('operator_not_verified',403);
  const members=await this.read('discuss.channel.member',[['id','in',channel.channel_member_ids]],['id','partner_id'],{limit:100});
  const allowed=new Set([rid(operator.partner_id),rid(channel.whatsapp_partner_id)]);
  if(members.length!==channel.channel_member_ids.length||members.some(m=>!allowed.has(rid(m.partner_id))))throw error('additional_channel_members',403);
  const text=mail.attachment_ids?.length?null:(await this.parse('Content-Type: text/html; charset=utf-8\r\n\r\n'+String(mail.body||''))).text;
  if(typeof text==='string'&&text.trim().length>8000)throw error('message_too_long',413);
  return {id:wa.id,event_id:`odoo:${c.account}:${wa.msg_uid}`,channel_id:channel.id,mail_id:mail.id,created_at:wa.create_date,text:typeof text==='string'?text.trim():null,unsupported_attachment:!!mail.attachment_ids?.length};
 }
 async events(after=0){
  const c=this.config();if(!Number.isSafeInteger(after)||after<0)throw error('invalid_cursor',400);
  const rows=await this.read('whatsapp.message',[['id','>',after],['wa_account_id','=',c.account],['state','=','received'],['message_type','=','inbound'],['mobile_number','in',[c.owner,'+'+c.owner]],['create_date','>=',new Date(Math.max(c.since,this.now()-86400000)).toISOString().slice(0,19).replace('T',' ')]],['id'],{limit:5,order:'id asc'});
  const events=[];for(const row of rows)events.push(await this.source(row.id));return {events,after:events.at(-1)?.id||after};
 }
 async reply({id,event_id,text}){
  if(!Number.isSafeInteger(id)||id<=0||typeof event_id!=='string'||event_id.length>500||typeof text!=='string'||!text.trim()||text.length>4000)throw error('invalid_reply',400);
  this.config();const h=hash({id,event_id,text}),old=this.db.prepare('SELECT * FROM peu_whatsapp_replies WHERE event_id=?').get(event_id);
  if(old){if(old.payload_hash!==h)throw error('reply_content_changed');return this.receipt(old);}
  if(this.env.PEU_WHATSAPP_REPLY_VERIFIED!=='true')throw error('whatsapp_reply_not_verified',503);
  this.assertWritable();if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='peu_recovery'").get()&&this.db.prepare('SELECT required FROM peu_recovery WHERE id=1').get()?.required)throw error('recovery_required',503);const src=await this.source(id);if(src.event_id!==event_id)throw error('source_mismatch',403);
  // Reserve synchronously before the first side effect. Never retry a lost response.
  const again=this.db.prepare('SELECT * FROM peu_whatsapp_replies WHERE event_id=?').get(event_id);if(again){if(again.payload_hash!==h)throw error('reply_content_changed');return this.receipt(again);}
  this.db.prepare('INSERT INTO peu_whatsapp_replies VALUES(?,?,?,NULL,NULL,?)').run(event_id,h,'sending',new Date(this.now()).toISOString());
  try{
   const result=await this.call('discuss.channel','message_post',[[src.channel_id]],{body:text,message_type:'whatsapp_message',subtype_xmlid:'mail.mt_comment',parent_id:src.mail_id});
   const mailId=Array.isArray(result)?result[0]:result;if(!Number.isSafeInteger(mailId)||mailId<=0)throw error('reply_result_unknown',502);
   this.db.prepare('UPDATE peu_whatsapp_replies SET status=?,mail_id=? WHERE event_id=?').run('queued',mailId,event_id);
   return this.receipt(this.db.prepare('SELECT * FROM peu_whatsapp_replies WHERE event_id=?').get(event_id));
  }catch(e){this.db.prepare("UPDATE peu_whatsapp_replies SET status='unknown' WHERE event_id=? AND status='sending'").run(event_id);throw error('reply_outcome_unknown',502);}
 }
 async receipt(row){
  if(row.mail_id){const c=this.config(),messages=await this.read('whatsapp.message',[['mail_message_id','=',row.mail_id],['wa_account_id','=',c.account],['message_type','=','outbound'],['mobile_number','in',[c.owner,'+'+c.owner]]],['id','state','msg_uid']);if(messages.length===1){const m=messages[0];this.db.prepare('UPDATE peu_whatsapp_replies SET status=?,provider_id=? WHERE event_id=?').run(m.state,m.msg_uid||null,row.event_id);return {status:m.state,provider_id:m.msg_uid||null,mail_id:row.mail_id};}}
  return {status:row.status,mail_id:row.mail_id,provider_id:row.provider_id};
 }
}
export function mountPeuWhatsApp(app,gateway){
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store');res.json(await fn(req));}catch(e){res.status(e.status||502).json({error:e.code||'whatsapp_odoo_unavailable'});}};
 app.get('/v1/peu/whatsapp/events',wrap(req=>gateway.events(Number(req.query.after||0))));
 app.post('/v1/peu/whatsapp/reply',wrap(req=>gateway.reply(req.body)));
}
