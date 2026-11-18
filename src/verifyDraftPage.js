// Bound IMAP load while avoiding a serial round trip for every pending draft.
// Preserve page order/cursor and keep rejected checks out of the approval list.
export async function verifyDraftPage(drafts,actions,verify){
 const keep=new Array(drafts.length).fill(false);let cursor=0,pending=0;
 async function worker(){for(;;){const i=cursor++;if(i>=drafts.length)return;
  const action=actions[drafts[i].action_id];
  if(!action||action.status!=='PENDING_APPROVAL')continue;
  if(!action.supersede_group?.startsWith('missing-details:')){keep[i]=true;continue;}
  try{keep[i]=await verify(action)===true&&action.status==='PENDING_APPROVAL';}catch{/* incomplete verification never authorizes a draft */}
  if(!keep[i]&&action.status==='PENDING_APPROVAL')pending++;
 }}
 await Promise.all(Array.from({length:Math.min(4,drafts.length)},worker));
 return {drafts:drafts.filter((_,i)=>keep[i]),verification_pending:pending};
}
