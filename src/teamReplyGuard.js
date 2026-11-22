// Inspect both sent mail and team replies delivered to our inbox (To or Cc).
// Exact RFC Message-ID ancestry keeps distinct customer requests separate.
export async function teamAlreadyReplied({parsed,accounts,withImap,evidence=false,parse}) {
 const id=String(parsed.messageId||'');
 if(!id||id.length>998||/[\r\n]/.test(id))throw Error('team_reply_check_missing_message_id');
 let latest=null;
 const addresses=value=>(Array.isArray(value)?value:value?.value||[]).map(v=>String(v.address||'').trim().toLowerCase()).filter(Boolean);
 const internal=address=>address.endsWith('@fancytruck.it');
 const customer=addresses(parsed.from).filter(a=>!internal(a));
 for(const account of accounts){
  const found=await withImap(account,async client=>{
   const folders=(await client.list()).filter(f=>f.specialUse==='\\Sent');
   if(folders.length!==1)throw Error('team_reply_check_sent_folder_unavailable');
   for(const folder of [{path:folders[0].path,sent:true},{path:'INBOX',sent:false}]){
    const lock=await client.getMailboxLock(folder.path,{readOnly:true});
    try{
     for(const field of ['in-reply-to','references']){
      const ids=await client.search({header:{[field]:id}},{uid:true});
      if(evidence&&ids.length>50)throw Error('team_reply_search_incomplete');
      for(const uid of ids){
       const message=await client.fetchOne(uid,{envelope:true,headers:['in-reply-to','references']},{uid:true});
       const envelope=message?.envelope||{};
       const header=String(message?.headers||'').replace(/\r?\n[ \t]+/g,' ');
       const refs=[...header.matchAll(/<[^<>\s]+>/g)].map(m=>m[0]);
       if(envelope.inReplyTo!==id&&!refs.includes(id))continue;
       if(parsed.date&&envelope.date&&new Date(envelope.date)<new Date(parsed.date))continue;
       {
        // An internal-only handoff is not an answer to the customer. Likewise,
        // another customer message in the thread is not evidence of team handling.
        const senders=addresses(envelope.from);
        const recipients=[...addresses(envelope.to),...addresses(envelope.cc)];
        if(!senders.length||!senders.every(internal))continue;
        if(!recipients.some(a=>!internal(a)&&(!customer.length||customer.includes(a))))continue;
       }
       if(!evidence)return true;
       if(typeof parse!=='function')throw Error('team_reply_parser_unavailable');
       const meta=await client.fetchOne(uid,{size:true},{uid:true});
       if(!Number.isSafeInteger(meta?.size)||meta.size>2*1024*1024)throw Error('team_reply_body_unavailable');
       const raw=await client.fetchOne(uid,{source:{start:0,maxLength:2*1024*1024+1}},{uid:true});
       if(!raw?.source||raw.source.length>2*1024*1024)throw Error('team_reply_body_unavailable');
       const full=await parse(raw.source);
       if(full.inReplyTo!==id)continue;
       const at=full.date?.toISOString?.();
       if(!full.messageId||!at||Date.parse(at)>Date.now()+60000)throw Error('team_reply_date_unavailable');
       if(!latest||at>latest.evidence.at)latest={handled:true,account,evidence:{message_id:full.messageId,at,text:full.text||''}};
      }
     }
    }finally{lock.release();}
   }
   return false;
  });
  if(found&&!evidence)return {handled:true,account};
 }
 return latest||{handled:false};
}

