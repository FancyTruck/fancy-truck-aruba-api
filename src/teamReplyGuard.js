import {replyAddresses,replyHeader,replyId,replyDate,replyEvidence,replySourceAvailable} from './teamReplyPayload.js';
const replyProblem=code=>Object.assign(new Error(code),{code,status:502});
async function* replyCandidates(client,id){
 const {exists,uidNext,uidValidity}=client.mailbox||{};
 if(!Number.isSafeInteger(exists)||exists<0||!Number.isSafeInteger(uidNext)||uidNext<1||uidNext>4294967295||exists>=uidNext||!uidValidity)throw replyProblem('team_reply_metadata_unavailable');
 const unchanged=()=>{const m=client.mailbox||{};if(m.exists!==exists||m.uidNext!==uidNext||String(m.uidValidity)!==String(uidValidity))throw replyProblem('team_reply_mailbox_changed');};
 for(let start=1;start<=exists;start+=200){
  if(start>20000)throw replyProblem('team_reply_search_incomplete');
  const end=Math.min(start+199,exists),seen=new Set();
  for(const field of ['in-reply-to','references']){
   const ids=await client.search({seq:`${start}:${end}`,header:{[field]:id}},{uid:true});unchanged();
   if(!Array.isArray(ids)||ids.length>end-start+1||new Set(ids).size!==ids.length||ids.some(uid=>!Number.isSafeInteger(uid)||uid<1||uid>=uidNext))throw replyProblem('team_reply_search_invalid');
   for(const uid of ids){if(seen.has(uid))continue;seen.add(uid);yield {uid,unchanged};unchanged();}
  }
 }
}
// Inspect both sent mail and team replies delivered to our inbox (To or Cc).
// Exact RFC Message-ID ancestry keeps distinct customer requests separate.
export async function teamAlreadyReplied({parsed,accounts,withImap,evidence=false,parse}) {
 const id=replyId(parsed.messageId);
 if(!id||id.length>998||/[\r\n]/.test(id))throw Error('team_reply_check_missing_message_id');
 let latest=null;
 const addresses=replyAddresses;
 const internal=address=>address.endsWith('@fancytruck.it');
 const customer=addresses(parsed.from).filter(a=>!internal(a));
 const originalDate=replyDate(parsed.date);
 for(const account of accounts){
  const found=await withImap(account,async client=>{
   const folders=(await client.list()).filter(f=>f.specialUse==='\\Sent');
   if(folders.length!==1)throw Error('team_reply_check_sent_folder_unavailable');
   for(const folder of [{path:folders[0].path,sent:true},{path:'INBOX',sent:false}]){
    const lock=await client.getMailboxLock(folder.path,{readOnly:true});
    try{
     let candidates=0;
     for await(const {uid,unchanged} of replyCandidates(client,id)){
       if(evidence&&++candidates>50)throw replyProblem('team_reply_search_incomplete');
       const message=await client.fetchOne(uid,{uid:true,envelope:true,headers:['in-reply-to','references']},{uid:true});unchanged();
       if(message?.uid!==uid)throw replyProblem('team_reply_uid_mismatch');
       const envelope=message?.envelope||{};
       const header=replyHeader(message?.headers);
       const parent=replyId(envelope.inReplyTo);
       // Scan bounded headers without retaining an array of every ancestry token.
       let related=parent===id;
       for(const match of header.matchAll(/<[^<>\s]+>/g)){if(match[0]===id){related=true;break;}}
       if(!related)continue;
       const envelopeDate=replyDate(envelope.date);
       if(originalDate&&envelopeDate&&envelopeDate<originalDate)continue;
       {
        // An internal-only handoff is not an answer to the customer. Likewise,
        // another customer message in the thread is not evidence of team handling.
        const senders=addresses(envelope.from);
        const recipients=addresses(envelope.to,envelope.cc);
        if(!senders.length||!senders.every(internal))continue;
        if(!recipients.some(a=>!internal(a)&&(!customer.length||customer.includes(a))))continue;
       }
       if(!evidence)return true;
       if(typeof parse!=='function')throw Error('team_reply_parser_unavailable');
       const meta=await client.fetchOne(uid,{size:true},{uid:true});
       unchanged();
       if(!Number.isSafeInteger(meta?.size)||meta.size<0||meta.size>2*1024*1024)throw Error('team_reply_body_unavailable');
       const raw=await client.fetchOne(uid,{source:{start:0,maxLength:2*1024*1024+1}},{uid:true});
       unchanged();
       if(!replySourceAvailable(raw?.source))throw Error('team_reply_body_unavailable');
       const full=await parse(raw.source);unchanged();
       if(replyId(full?.inReplyTo)!==id)continue;
       const proof=replyEvidence(full);
       if(!latest||proof.at>latest.evidence.at)latest={handled:true,account,evidence:proof};
     }
    }finally{lock.release();}
   }
   return false;
  });
  if(found&&!evidence)return {handled:true,account};
 }
 return latest||{handled:false};
}
