import {problem,transaction} from './peuMailDb.js';
import {readFolder,reconcileSent} from './peuMailSync.js';
// Project legacy cache rows inside SQLite BEFORE crossing into JS. Older rows
// may contain base64 attachment bodies; stripping them after JSON.parse is too late.
const publicPayload = `CASE WHEN length(payload)>16777216 THEN
 json_object('text','','attachments',json('[]'),'content_status','requires_large_message_download')
 ELSE json_object(
 'content_status',json_extract(payload,'$.content_status'),
 'source_size',json_extract(payload,'$.source_size'),
 'subject',substr(json_extract(payload,'$.subject'),1,2000),
 'text',substr(coalesce(json_extract(payload,'$.text'),''),1,20000),
 'text_truncated',length(coalesce(json_extract(payload,'$.text'),''))>20000,
 'date',json_extract(payload,'$.date'),
 'from',json(coalesce(json_extract(payload,'$.from'),'[]')),
 'to',json(coalesce(json_extract(payload,'$.to'),'[]')),
 'inReplyTo',json_extract(payload,'$.inReplyTo'),
 'references',json(coalesce(json_extract(payload,'$.references'),'[]')),
 'attachments',json(coalesce((SELECT json_group_array(json_object(
 'index',key,'filename',json_extract(value,'$.filename'),
 'contentType',json_extract(value,'$.contentType'),'size',json_extract(value,'$.size')))
 FROM json_each(payload,'$.attachments')),'[]'))) END AS payload`;
function publicMessage(row){return {...row,payload:JSON.parse(row.payload)};}
// Runs inside Fancy using its existing authenticated clients and approval service.
export class ArubaService {
 constructor({db,withImap,parse,smtp,approvals,accounts}){Object.assign(this,{db,withImap,parse,smtp,approvals,accounts});}
 account(id){if(!this.accounts.includes(id))throw problem('account_not_authorized',403);}
 async folders(account){this.account(account);return this.withImap(account,async client=>({folders:(await client.list()).filter(f=>f.path==='INBOX'||f.specialUse==='\\Sent').map(f=>({path:f.path,role:f.path==='INBOX'?'inbox':'sent'}))}));}
 thread(account,key){this.account(account);return {messages:Array.from(this.db.prepare(`SELECT folder,validity,uid,message_id,thread_key,${publicPayload},flags FROM mail_messages WHERE account=? AND thread_key=? AND deleted=0 ORDER BY uid LIMIT 100`).iterate(account,key),publicMessage)};}
 async sync(account,folder){this.account(account);return this.withImap(account,async client=>{
   const folders=await client.list();if(!folders.some(f=>f.path===folder&&(f.path==='INBOX'||f.specialUse==='\\Sent')))throw problem('folder_not_authorized',403);
   let cursor=this.db.prepare('SELECT validity,last_uid uid FROM mail_cursors WHERE account=? AND folder=?').get(account,folder),total=0;
   for(let page=0;page<10000;page++){
     // A source may contain large MIME attachments: never retain 100 raw mails.
     const batch=await readFolder(client,folder,cursor,1),parsed=[];
     for(const item of batch.items){const m=item.source===null?{subject:item.envelope?.subject||'',text:'',date:item.envelope?.date,from:{value:item.envelope?.from||[]},to:{value:item.envelope?.to||[]},messageId:item.envelope?.messageId,inReplyTo:item.envelope?.inReplyTo,attachments:[]}:await this.parse(Buffer.from(item.source,'base64'));const id=m.messageId||null,refs=Array.isArray(m.references)?m.references:typeof m.references==='string'?m.references.split(/\s+/):[];parsed.push({...item,message_id:id,thread_key:refs[0]||m.inReplyTo||id||`${batch.cursor.validity}:${item.uid}`,payload:JSON.stringify({content_status:item.content_status||'available',source_size:item.size||null,subject:m.subject||'',text:m.text||'',date:m.date?.toISOString()||null,from:m.from?.value||[],to:m.to?.value||[],inReplyTo:m.inReplyTo||null,references:refs,attachments:(m.attachments||[]).map((a,index)=>({index,filename:a.filename||null,contentType:a.contentType,size:a.size}))})});}
     transaction(this.db,()=>{if(batch.reset)this.db.prepare('UPDATE mail_messages SET deleted=1 WHERE account=? AND folder=?').run(account,folder);
       for(const m of parsed)this.db.prepare('INSERT INTO mail_messages VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(account,folder,validity,uid) DO UPDATE SET payload=excluded.payload,flags=excluded.flags,deleted=0').run(account,folder,batch.cursor.validity,m.uid,m.message_id,m.thread_key,m.payload,JSON.stringify(m.flags));
       this.db.prepare('INSERT INTO mail_cursors VALUES(?,?,?,?) ON CONFLICT(account,folder) DO UPDATE SET validity=excluded.validity,last_uid=excluded.last_uid').run(account,folder,batch.cursor.validity,batch.cursor.uid);
     });cursor=batch.cursor;total+=parsed.length;if(total&&total%100===0)console.log(JSON.stringify({event:'peu_aruba_progress',messages:total}));if(!batch.hasMore)break;if(page===9999)throw problem('mail_sync_more_pages',503);
   }
   const lock=await client.getMailboxLock(folder,{readOnly:true});try{
     if(String(client.mailbox.uidValidity)!==cursor.validity)throw problem('uidvalidity_changed_retry',409);
     const ids=await client.search({all:true},{uid:true});const flags=[];
     for(let i=0;i<ids.length;i+=200)for await(const row of client.fetch(ids.slice(i,i+200).join(','),{uid:true,flags:true},{uid:true}))flags.push({uid:row.uid,flags:[...row.flags]});
     transaction(this.db,()=>{this.db.prepare('UPDATE mail_messages SET deleted=1 WHERE account=? AND folder=? AND validity=?').run(account,folder,cursor.validity);for(const row of flags)this.db.prepare('UPDATE mail_messages SET flags=?,deleted=0 WHERE account=? AND folder=? AND validity=? AND uid=?').run(JSON.stringify(row.flags),account,folder,cursor.validity,row.uid);});
   }finally{lock.release();}
   const restricted=this.db.prepare("SELECT count(*) n FROM mail_messages WHERE account=? AND folder=? AND validity=? AND deleted=0 AND json_extract(payload,'$.content_status')='requires_large_message_download'").get(account,folder,cursor.validity).n;
   return {status:'synced',new_messages:total,cursor,restricted_messages:restricted,content_coverage:restricted?'partial':'available'};
 });}
 messages(account,folder){this.account(account);return Array.from(this.db.prepare(`SELECT account,folder,validity,uid,message_id,thread_key,flags,deleted,${publicPayload} FROM mail_messages WHERE account=? AND folder=? AND deleted=0 ORDER BY uid DESC LIMIT 100`).iterate(account,folder),publicMessage);}
 async attachment(account,folder,validity,uid,index){this.account(account);const r=this.db.prepare('SELECT uid FROM mail_messages WHERE account=? AND folder=? AND validity=? AND uid=? AND deleted=0').get(account,folder,validity,uid);if(!r)throw problem('message_not_found',404);
   return this.withImap(account,async client=>{const lock=await client.getMailboxLock(folder,{readOnly:true});try{
     if(String(client.mailbox.uidValidity)!==validity)throw problem('uidvalidity_changed_retry',409);
     const meta=await client.fetchOne(uid,{size:true},{uid:true});if(!meta)throw problem('message_not_found',404);if(meta.size>20*1024*1024)throw problem('attachment_requires_large_message_download',413);
     const raw=await client.fetchOne(uid,{source:{start:0,maxLength:20*1024*1024+1}},{uid:true});if(!raw?.source)throw problem('message_not_found',404);
     if(raw.source.length>20*1024*1024)throw problem('attachment_requires_large_message_download',413);
     const parsed=await this.parse(raw.source),a=parsed.attachments?.[index];if(!a)throw problem('attachment_not_found',404);
     return {index,filename:a.filename||null,contentType:a.contentType,size:a.size,content:a.content.toString('base64')};
   }finally{lock.release();}});
 }

}
