const problem=code=>Object.assign(new Error(code),{code,status:502});
// IMAP HEADER uses substring matching. This only discovers candidates; callers
// must verify the exact parsed/envelope identity before accepting a result.
export async function headerCandidates(client,messageId){
 if(typeof messageId!=='string'||!messageId.length||messageId.length>998||/[\r\n]/.test(messageId))throw problem('invalid_message_id');
 const {exists,uidNext,uidValidity}=client.mailbox||{};
 if(!Number.isSafeInteger(exists)||exists<0||!Number.isSafeInteger(uidNext)||uidNext<1||uidNext>4294967295||exists>=uidNext||!uidValidity)throw problem('mailbox_metadata_unavailable');
 const unchanged=()=>{const m=client.mailbox||{};if(m.exists!==exists||m.uidNext!==uidNext||String(m.uidValidity)!==String(uidValidity))throw problem('mailbox_changed_retry');};
 const ids=[];
 for(let start=1;start<=exists;start+=200){
  // Bounded work per call; exhausted coverage must never mean "not found".
  if(start>20000)throw problem('mail_header_lookup_incomplete');
  const end=Math.min(start+199,exists);
  const rows=await client.search({seq:`${start}:${end}`,header:{'message-id':messageId}},{uid:true});unchanged();
  if(!Array.isArray(rows)||rows.length>end-start+1||new Set(rows).size!==rows.length||rows.some(uid=>!Number.isSafeInteger(uid)||uid<1||uid>=uidNext||ids.includes(uid)))throw problem('mail_header_search_invalid');
  for(const uid of rows){ids.push(uid);if(ids.length===2)return {ids,unchanged};}
 }
 return {ids,unchanged};
}
