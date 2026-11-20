import {newUidPage} from './mailUidPage.js';
import {problem} from './peuMailDb.js';
const MAX_SOURCE_BYTES=20*1024*1024;
// Two bounded IMAP FETCH commands replace per-message round trips on backfills.
async function batchItems(client,selected){
 const metadata=new Map();
 for await(const row of client.fetch(selected.join(','),{uid:true,size:true,envelope:true,flags:true},{uid:true})){
  if(!selected.includes(row.uid)||metadata.has(row.uid))throw problem('message_uid_mismatch',502);
  metadata.set(row.uid,row);
 }
 const chosen=[],small=[];let budget=0;
 for(const uid of selected){
  const m=metadata.get(uid);
  if(!m||!Number.isSafeInteger(m.size)||m.size<0)throw problem('message_size_unavailable',502);
  if(m.size>MAX_SOURCE_BYTES){if(!m.envelope)throw problem('message_metadata_unavailable',502);chosen.push(uid);continue;}
  if(chosen.length&&budget+m.size>MAX_SOURCE_BYTES)break;
  budget+=m.size;chosen.push(uid);small.push(uid);
 }
 const sources=new Map();let actual=0;
 if(small.length)for await(const m of client.fetch(small.join(','),{uid:true,source:{start:0,maxLength:MAX_SOURCE_BYTES+1}},{uid:true})){
  if(!small.includes(m.uid)||sources.has(m.uid))throw problem('message_uid_mismatch',502);
  if(!m.source||m.source.length>MAX_SOURCE_BYTES)throw problem('mail_sync_large_message_requires_review',413);
  actual+=m.source.length;if(actual>MAX_SOURCE_BYTES)throw problem('mail_sync_large_message_requires_review',413);
  sources.set(m.uid,m.source.toString('base64'));
 }
 return chosen.map(uid=>{
  const m=metadata.get(uid);
  if(m.size<=MAX_SOURCE_BYTES&&!sources.has(uid))throw problem('message_metadata_unavailable',502);
  return {uid,envelope:m.envelope,flags:[...(m.flags||[])],size:m.size,
   source:m.size>MAX_SOURCE_BYTES?null:sources.get(uid),
   content_status:m.size>MAX_SOURCE_BYTES?'requires_large_message_download':'available'};
 });
}
// Reuses an authenticated ImapFlow client created by Fancy's existing account resolver.
// No independent polling service or production credential configuration.
export async function readFolder(client,folder,cursor,limit=100){
  const lock=await client.getMailboxLock(folder,{readOnly:true});try{
    const validity=String(client.mailbox.uidValidity),reset=!cursor||cursor.validity!==validity;
    const since=reset?1:Number(cursor.uid)+1,items=[];
    let totalBytes=0;
    const page=await newUidPage(client,since,limit,validity),ids=page.ids;
    const selected=ids.filter(id=>id>=since).sort((a,b)=>a-b).slice(0,limit);
    if(selected.length&&limit>1&&typeof client.fetch==='function')items.push(...await batchItems(client,selected));
    else for(const uid of selected){
      const meta=await client.fetchOne(uid,{size:true},{uid:true});
      if(!meta||!Number.isSafeInteger(meta.size)||meta.size<0)throw problem('message_size_unavailable',502);
      if(meta.size>MAX_SOURCE_BYTES){
        const m=await client.fetchOne(uid,{uid:true,envelope:true,flags:true},{uid:true});
        if(!m||m.uid!==uid)throw problem('message_metadata_unavailable',502);
        items.push({uid,envelope:m.envelope,flags:[...m.flags],source:null,content_status:'requires_large_message_download',size:meta.size});
        continue;
      }
      if(items.length&&totalBytes+meta.size>MAX_SOURCE_BYTES)break;
      const m=await client.fetchOne(uid,{uid:true,envelope:true,flags:true,bodyStructure:true,source:{start:0,maxLength:MAX_SOURCE_BYTES+1}},{uid:true});
      if(!m?.source||m.source.length>MAX_SOURCE_BYTES)throw problem('mail_sync_large_message_requires_review',413);
      // A mismatched response cannot choose the durable cursor or cache key.
      if(m.uid!==uid)throw problem('message_uid_mismatch',502);
      if(items.length&&totalBytes+m.source.length>MAX_SOURCE_BYTES)break;
      totalBytes+=m.source.length;
      items.push({uid:m.uid,envelope:m.envelope,flags:[...m.flags],bodyStructure:m.bodyStructure,source:m.source.toString('base64')});
    }
    page.unchanged();
    return {folder,reset,items,cursor:{validity,uid:items.length?Math.max(...items.map(m=>m.uid)):reset?0:cursor.uid},hasMore:page.more||ids.length>items.length};
  }finally{lock.release();}
}
export async function folders(client){const list=await client.list();return list.filter(f=>f.path==='INBOX'||f.specialUse==='\\Sent').map(f=>({path:f.path,role:f.path==='INBOX'?'inbox':'sent'}));}
export async function reconcileSent(client,folder,messageId){const lock=await client.getMailboxLock(folder);try{const ids=await client.search({header:{'message-id':messageId}},{uid:true});return {status:ids.length?'verified_sent':'unresolved',uids:ids};}finally{lock.release();}}
