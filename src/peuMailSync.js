// Reuses an authenticated ImapFlow client created by Fancy's existing account resolver.
// No independent polling service or production credential configuration.
export async function readFolder(client,folder,cursor,limit=100){
  const lock=await client.getMailboxLock(folder,{readOnly:true});try{
    const validity=String(client.mailbox.uidValidity),reset=!cursor||cursor.validity!==validity;
    const since=reset?1:Number(cursor.uid)+1,items=[];
    // Search avoids IMAP's N:* reversal when N exceeds the current maximum UID.
    const ids=await client.search({uid:`${since}:*`},{uid:true});
    const selected=ids.filter(id=>id>=since).sort((a,b)=>a-b).slice(0,limit);
    if(selected.length)for await(const m of client.fetch(selected.join(','),{uid:true,envelope:true,flags:true,bodyStructure:true,source:true},{uid:true}))items.push({uid:m.uid,envelope:m.envelope,flags:[...m.flags],bodyStructure:m.bodyStructure,source:m.source.toString('base64')});
    return {folder,reset,items,cursor:{validity,uid:items.length?Math.max(...items.map(m=>m.uid)):reset?0:cursor.uid},hasMore:ids.filter(id=>id>=since).length>selected.length};
  }finally{lock.release();}
}
export async function folders(client){const list=await client.list();return list.filter(f=>f.path==='INBOX'||f.specialUse==='\\Sent').map(f=>({path:f.path,role:f.path==='INBOX'?'inbox':'sent'}));}
export async function reconcileSent(client,folder,messageId){const lock=await client.getMailboxLock(folder);try{const ids=await client.search({header:{'message-id':messageId}},{uid:true});return {status:ids.length?'verified_sent':'unresolved',uids:ids};}finally{lock.release();}}
