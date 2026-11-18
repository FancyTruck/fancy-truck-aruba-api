// Read the actual sent folders, including historical replies predating poll cursors.
// Exact RFC Message-ID ancestry avoids confusing separate projects of one customer.
export async function teamAlreadyReplied({parsed,accounts,withImap}) {
 const id=String(parsed.messageId||'');
 if(!id||id.length>998||/[\r\n]/.test(id))throw Error('team_reply_check_missing_message_id');
 for(const account of accounts){
  const found=await withImap(account,async client=>{
   const folders=(await client.list()).filter(f=>f.specialUse==='\\Sent');
   if(folders.length!==1)throw Error('team_reply_check_sent_folder_unavailable');
   const lock=await client.getMailboxLock(folders[0].path,{readOnly:true});
   try{
    for(const field of ['in-reply-to','references']){
     const ids=await client.search({header:{[field]:id}},{uid:true});
     for(const uid of ids){
      const message=await client.fetchOne(uid,{envelope:true,headers:['in-reply-to','references']},{uid:true});
      const header=String(message?.headers||'').replace(/\r?\n[ \t]+/g,' ');
      const refs=[...header.matchAll(/<[^<>\s]+>/g)].map(m=>m[0]);
      if((message?.envelope?.inReplyTo===id||refs.includes(id)) && (!parsed.date||!message.envelope?.date||new Date(message.envelope.date)>=new Date(parsed.date)))return true;
     }
    }
    return false;
   }finally{lock.release();}
  });
  if(found)return {handled:true,account};
 }
 return {handled:false};
}
