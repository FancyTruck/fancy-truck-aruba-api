import {problem} from './peuMailDb.js';
const MAX_SOURCE_BYTES=20*1024*1024;
// Reuses an authenticated ImapFlow client created by Fancy's existing account resolver.
// No independent polling service or production credential configuration.
export async function readFolder(client,folder,cursor,limit=100){
  const lock=await client.getMailboxLock(folder,{readOnly:true});try{
    const validity=String(client.mailbox.uidValidity),reset=!cursor||cursor.validity!==validity;
    const since=reset?1:Number(cursor.uid)+1,items=[];
    let totalBytes=0;
    // Search avoids IMAP's N:* reversal when N exceeds the current maximum UID.
    const ids=await client.search({uid:`${since}:*`},{uid:true});
    const selected=ids.filter(id=>id>=since).sort((a,b)=>a-b).slice(0,limit);
    for(const uid of selected){
      const meta=await client.fetchOne(uid,{size:true},{uid:true});
      if(!meta||!Number.isSafeInteger(meta.size))throw problem('message_size_unavailable',502);
      if(meta.size>MAX_SOURCE_BYTES){
        const m=await client.fetchOne(uid,{uid:true,envelope:true,flags:true},{uid:true});
        if(!m||m.uid!==uid)throw problem('message_metadata_unavailable',502);
        items.push({uid,envelope:m.envelope,flags:[...m.flags],source:null,content_status:'requires_large_message_download',size:meta.size});
        continue;
      }
      if(items.length&&totalBytes+meta.size>MAX_SOURCE_BYTES)break;
      const m=await client.fetchOne(uid,{uid:true,envelope:true,flags:true,bodyStructure:true,source:{start:0,maxLength:MAX_SOURCE_BYTES+1}},{uid:true});
      if(!m?.source||m.source.length>MAX_SOURCE_BYTES)throw problem('mail_sync_large_message_requires_review',413);
      if(items.length&&totalBytes+m.source.length>MAX_SOURCE_BYTES)break;
      totalBytes+=m.source.length;
      items.push({uid:m.uid,envelope:m.envelope,flags:[...m.flags],bodyStructure:m.bodyStructure,source:m.source.toString('base64')});
    }
    return {folder,reset,items,cursor:{validity,uid:items.length?Math.max(...items.map(m=>m.uid)):reset?0:cursor.uid},hasMore:ids.filter(id=>id>=since).length>items.length};
  }finally{lock.release();}
}
export async function folders(client){const list=await client.list();return list.filter(f=>f.path==='INBOX'||f.specialUse==='\\Sent').map(f=>({path:f.path,role:f.path==='INBOX'?'inbox':'sent'}));}
export async function reconcileSent(client,folder,messageId){const lock=await client.getMailboxLock(folder);try{const ids=await client.search({header:{'message-id':messageId}},{uid:true});return {status:ids.length?'verified_sent':'unresolved',uids:ids};}finally{lock.release();}}
