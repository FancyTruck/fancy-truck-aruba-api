const problem=(code,status)=>Object.assign(new Error(code),{code,status});
// Locate the first unseen UID by sequence metadata, then SEARCH at most101
// message positions. Sparse UID numbers do not cause empty-range scanning.
export async function newUidPage(client,since,limit,validity){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw problem('invalid_mail_page_limit',400);
 const {exists,uidNext}=client.mailbox;
 if(!Number.isSafeInteger(exists)||exists<0||!Number.isSafeInteger(uidNext)||uidNext<1||uidNext>4294967295||exists>=uidNext||!Number.isSafeInteger(since)||since<1)throw problem('mailbox_metadata_unavailable',502);
 const unchanged=()=>{if(client.mailbox?.exists!==exists||client.mailbox?.uidNext!==uidNext||String(client.mailbox?.uidValidity)!==validity)throw problem('mailbox_changed_retry',409);};
 unchanged();
 if(!exists||since>=uidNext)return {ids:[],more:false,unchanged};
 let start=1;
 if(exists>101&&since>1){
  let low=1,high=exists+1,lower=0,upper=uidNext;
  while(low<high){
   const mid=Math.floor((low+high)/2),row=await client.fetchOne(mid,{uid:true},{uid:false});unchanged();
   if(!row||row.seq!==mid||!Number.isSafeInteger(row.uid)||row.uid<=lower||row.uid>=upper)throw problem('message_uid_probe_unavailable',502);
   if(row.uid<since){low=mid+1;lower=row.uid;}else{high=mid;upper=row.uid;}
  }
  start=low;
 }
 if(start>exists)return {ids:[],more:false,unchanged};
 const end=Math.min(start+100,exists),found=await client.search({seq:`${start}:${end}`},{uid:true});unchanged();
 if(!Array.isArray(found))throw problem('mail_uid_search_unavailable',502);
 if(found.length!==end-start+1)throw problem('mail_uid_search_incomplete',502);
 if(new Set(found).size!==found.length||found.some(uid=>!Number.isSafeInteger(uid)||uid<1||uid>=uidNext)||(start>1&&found.some(uid=>uid<since)))throw problem('message_uid_mismatch',502);
 return {ids:found.filter(uid=>uid>=since).sort((a,b)=>a-b),more:end<exists,unchanged};
}
