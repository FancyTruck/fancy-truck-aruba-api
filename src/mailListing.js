import {listingMetadata,metadataReview,LISTING_PAGE_BYTES} from './mailListingMetadata.js';
const problem=(code,status=502)=>Object.assign(new Error(code),{code,status});
export function listingOptions(query){
 const limit=query.limit===undefined?20:Number(query.limit);
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw problem('invalid_mail_limit',400);
 if(query.unseen!==undefined&&!['true','false'].includes(String(query.unseen)))throw problem('invalid_unseen_filter',400);
 const since=query.since===undefined?null:new Date(String(query.since));
 if(since&&!Number.isFinite(+since))throw problem('invalid_since_filter',400);
 return {limit,unseenOnly:String(query.unseen)==='true',since};
}
// Called under the existing readonly INBOX lock. Search newest positions first;
// never collect all mailbox UIDs just to return the latest few messages.
export async function listMailboxMessages(client,{limit,unseenOnly=false,since=null,resume=null}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw problem('invalid_mail_limit',400);
 const {exists,uidNext,uidValidity}=client.mailbox||{};
 if(!Number.isSafeInteger(exists)||exists<0||!Number.isSafeInteger(uidNext)||uidNext<1||uidNext>4294967295||exists>=uidNext||!uidValidity)throw problem('mailbox_metadata_unavailable');
 const unchanged=()=>{const m=client.mailbox||{};if(m.exists!==exists||m.uidNext!==uidNext||String(m.uidValidity)!==String(uidValidity))throw problem('mailbox_changed_retry');};
 const snapshot={exists,uidNext,uidValidity:String(uidValidity)};
 if(resume&&(JSON.stringify(resume.snapshot)!==JSON.stringify(snapshot)||!Number.isSafeInteger(resume.end)||resume.end<1||resume.end>exists))throw problem('mail_cursor_snapshot_changed',409);
 let end=resume?resume.end:exists,scanned=0,moreMatches=false;const selected=[];
 while(end>0&&selected.length<limit&&scanned<20000){
  const start=Math.max(1,end-199),search={seq:`${start}:${end}`};
  if(unseenOnly)search.seen=false;if(since)search.since=since;
  const ids=await client.search(search,{uid:true});unchanged();
  if(!Array.isArray(ids)||ids.length>end-start+1||new Set(ids).size!==ids.length||ids.some(uid=>!Number.isSafeInteger(uid)||uid<1||uid>=uidNext||selected.some(row=>row.uid===uid)))throw problem('mail_listing_search_invalid');
  if(!unseenOnly&&!since&&ids.length!==end-start+1)throw problem('mail_listing_search_incomplete');
  const sorted=ids.slice().sort((a,b)=>b-a),room=limit-selected.length;
  moreMatches=sorted.length>room;
  for(const uid of sorted.slice(0,room))selected.push({uid,start,end});
  scanned+=end-start+1;end=start-1;
 }
 const messages=[];let lastSequence=null,metadataBytes=2;
 for(const row of selected){
  const message=await client.fetchOne(row.uid,{uid:true,envelope:true,flags:true,internalDate:true,size:true},{uid:true});unchanged();
  if(message?.uid!==row.uid||!Number.isSafeInteger(message?.seq)||message.seq<row.start||message.seq>row.end)throw problem('message_uid_mismatch');
  if(!Number.isSafeInteger(message.size)||message.size<0)throw problem('message_size_unavailable');
  lastSequence=message.seq;
  let projected=listingMetadata(message,row.uid),bytes=Buffer.byteLength(JSON.stringify(projected));
  // Reserve room for explicit review placeholders for every remaining row.
  if(metadataBytes+bytes+1>LISTING_PAGE_BYTES-(selected.length-messages.length-1)*512){projected=metadataReview(row.uid,message.size);bytes=Buffer.byteLength(JSON.stringify(projected));}
  metadataBytes+=bytes+(messages.length?1:0);messages.push(projected);
 }
 unchanged();
 // An overflowing search window must resume before the LAST RETURNED message,
 // not before the whole searched window: otherwise unreturned matches vanish.
 if(moreMatches)end=lastSequence-1;
 const continuation=end>0?{snapshot,end,...(resume?.expires_at?{expires_at:resume.expires_at}:{})}:null;
 return {continuation,messages,metadata_complete:messages.every(m=>m.metadata_complete),metadata_bytes:metadataBytes,partial:end>0||moreMatches,has_more:moreMatches?true:end>0?null:false,scanned_positions:scanned,older_messages_unscanned:end};
}
