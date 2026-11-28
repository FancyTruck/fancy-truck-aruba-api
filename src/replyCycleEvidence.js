import {replyAddresses,replyEvidence} from './teamReplyPayload.js';
const incomplete=()=>Object.assign(Error('reply_evidence_incomplete'),{code:'reply_evidence_incomplete',status:503});
const sendTypes=new Set(['SEND_EMAIL','SEND_FOLLOW_UP','SEND_PAYMENT_REMINDER','SEND_QUOTE','SEND_CONTRACT','SEND_INVOICE']);
function boundedText(value,max){
 if(typeof value!=='string'||value.length>max||Buffer.byteLength(value,'utf8')>max)throw incomplete();
 return value;
}
function proof(value){
 try{return replyEvidence({messageId:value?.message_id,date:value?.at,text:value?.text});}catch{throw incomplete();}
}
function accepted(result,sender){
 const list=result?.accepted;
 if(!Array.isArray(list)||list.length>100||(result.rejected!=null&&!Array.isArray(result.rejected)))throw incomplete();
 if(result.rejected?.length)return false;
 return list.some(v=>boundedText(v,998).toLowerCase()===sender);
}
// Only exact RFC replies and durable send receipts. No subject/name matching or source writes.
export async function replyCycleEvidence({account,messageId,sender,readOriginal,actions,teamCheck}){
 boundedText(messageId,998);boundedText(sender,998);const customer=sender.toLowerCase();
 const response=await readOriginal(account,messageId),original=response?.original;
 let addresses;
 try{addresses=replyAddresses(original?.payload?.replyTo?.length?original.payload.replyTo:original?.payload?.from);}catch{throw incomplete();}
 if(original?.message_id!==messageId||!original.payload?.text||original.payload.text_truncated||!addresses.includes(customer))throw Object.assign(Error('reply_original_unverified'),{code:'reply_original_unverified',status:409});
 const originalText=boundedText(original.payload.text,2*1024*1024);
 const source={message_id:messageId,sender,text:originalText.slice(0,18000),text_truncated:originalText.length>18000};
 // One bounded pass, without copying or sorting the complete retained action ledger.
 const ledger=actions??{};if(typeof ledger!=='object'||Array.isArray(ledger))throw incomplete();
 let latest=null,latestAt=-Infinity,count=0;
 for(const key in ledger){
  if(!Object.hasOwn(ledger,key))continue;
  if(++count>10000)throw incomplete();
  const a=ledger[key];
  if(!a||!sendTypes.has(a.type)||a.status!=='EXECUTED'||a.payload?.account!==account||a.payload.inReplyTo!==messageId)continue;
  if(boundedText(a.payload.to||a.target||'',998).toLowerCase()!==customer)continue;
  if(!accepted(a.result,customer)||!a.result.message_id)continue;
  const stamp=boundedText(a.executed_at,128),at=Date.parse(stamp);
  if(!Number.isFinite(at))continue;
  if(at>=latestAt){latest=a;latestAt=at;}
 }
 const local=latest?{...proof({message_id:latest.result.message_id,at:latest.executed_at,text:latest.payload.text??''}),receipt:'smtp_accepted'}:null;
 const result=await teamCheck({messageId,date:original.payload.date,from:{value:[{address:sender}]}},true);
 if(typeof result?.handled!=='boolean')throw incomplete();
 if(!result.handled)return local?{ok:true,handled:true,account,in_reply_to:messageId,to:sender,original:source,outgoing:local}:{ok:true,handled:false,account,in_reply_to:messageId,to:sender,original:source};
 const remote=proof(result.evidence);if(!remote.text)throw incomplete();
 return {ok:true,handled:true,account,in_reply_to:messageId,to:sender,original:source,outgoing:local&&Date.parse(local.at)>Date.parse(remote.at)?local:{...remote,receipt:'sent_mailbox'}};
}
