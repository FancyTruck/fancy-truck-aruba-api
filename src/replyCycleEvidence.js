// Only exact RFC replies and durable send receipts. No subject/name matching or source writes.
export async function replyCycleEvidence({account,messageId,sender,readOriginal,actions,teamCheck}){
 const response=await readOriginal(account,messageId),original=response?.original;
 if(original?.message_id!==messageId||!original.payload?.text||original.payload.text_truncated||!(original.payload.replyTo?.length?original.payload.replyTo:original.payload.from)?.some(x=>String(x.address).toLowerCase()===sender.toLowerCase()))throw Object.assign(Error('reply_original_unverified'),{code:'reply_original_unverified',status:409});
 const source={message_id:messageId,sender,text:original.payload.text.slice(0,18000),text_truncated:original.payload.text.length>18000};
 const candidates=Object.values(actions||{}).filter(a=>['SEND_EMAIL','SEND_FOLLOW_UP','SEND_PAYMENT_REMINDER','SEND_QUOTE','SEND_CONTRACT','SEND_INVOICE'].includes(a.type)&&a.status==='EXECUTED'&&a.payload?.account===account&&a.payload.inReplyTo===messageId&&String(a.payload.to||a.target||'').toLowerCase()===sender.toLowerCase()&&a.result?.accepted?.some(x=>String(x).toLowerCase()===sender.toLowerCase())&&!a.result?.rejected?.length&&a.result?.message_id&&Number.isFinite(Date.parse(a.executed_at))).sort((a,b)=>a.executed_at.localeCompare(b.executed_at));
 const a=candidates.at(-1);
 const local=a?{message_id:a.result.message_id,at:a.executed_at,text:a.payload.text||'',receipt:'smtp_accepted'}:null;
 const result=await teamCheck({messageId,date:original.payload.date,from:{value:[{address:sender}]}},true);
 if(!result?.handled)return local?{ok:true,handled:true,account,in_reply_to:messageId,to:sender,original:source,outgoing:local}:{ok:true,handled:false,account,in_reply_to:messageId,to:sender,original:source};
 if(!result.evidence?.message_id||!result.evidence?.text||!Number.isFinite(Date.parse(result.evidence.at)))throw Object.assign(Error('reply_evidence_incomplete'),{code:'reply_evidence_incomplete',status:503});
 return {ok:true,handled:true,account,in_reply_to:messageId,to:sender,original:source,outgoing:local&&local.at>result.evidence.at?local:{...result.evidence,receipt:'sent_mailbox'}};
}
