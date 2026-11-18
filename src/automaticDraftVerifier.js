const address=value=>String(value||'').match(/<([^<>\s]+@[^<>\s]+)>|^([^<>\s]+@[^<>\s]+)$/)?.slice(1).find(Boolean)?.toLowerCase()||'';
function incomplete(code){throw Object.assign(Error(code),{code});}
export function automaticDraftVerifier({readOriginal,odooRead,classify,teamCheck,store,canRetire=()=>true,log=console.log}){
 function cancel(action,reason){
  if(action.status!=='PENDING_APPROVAL')return false;
  if(!canRetire())incomplete('draft_recovery_writes_blocked');
  const old={...action};Object.assign(action,{status:'CANCELLED',cancel_reason:reason,cancelled_at:new Date().toISOString()});
  try{store.save();}catch(error){Object.assign(action,old);for(const k of ['cancel_reason','cancelled_at'])if(!(k in old))delete action[k];throw error;}
  store.audit('ACTION_CANCELLED',{action_id:action.id,reason});
  log(JSON.stringify({event:'draft_verification',action_id:action.id,status:'obsolete',reason}));return false;
 }
 return async action=>{
  try{
   const id=action.payload?.inReplyTo;if(!id)incomplete('draft_source_reference_missing');
   const response=await readOriginal(action.payload.account,id),original=response.original;if(!original?.payload?.text)incomplete(response.reason||'draft_original_not_found');
   if(original.payload.text_truncated)incomplete('draft_original_incomplete');
   const source=original.payload,decision=classify(source.subject,source.text);
   if(!decision.kind||['supplier_offer','non_customer_direction_requires_review','administrative_or_marketing','automatic_or_mailing_list','automatic_service_notification'].includes(decision.reason))return cancel(action,'NOT_CUSTOMER_REQUEST');
   // Odoo can retain the received message even after it leaves Aruba INBOX.
   // A later customer answer supersedes an old automatic request for details.
   if(original.source==='odoo_received'){
    const rows=await odooRead('mail.message',[['model','=','crm.lead'],['res_id','=',original.case_id],['message_type','=','email'],['id','>',original.odoo_message_id]],{fields:['email_from','parent_id','date'],order:'id asc',limit:101});
    if(rows.length>100)incomplete('draft_thread_verification_incomplete');
    const customer=String(source.from?.[0]?.address||'').toLowerCase();
    if(rows.some(row=>address(row.email_from)===customer))return cancel(action,'CUSTOMER_REPLIED_AFTER_SOURCE');
    if(rows.some(row=>address(row.email_from).endsWith('@fancytruck.it')&&(Array.isArray(row.parent_id)?row.parent_id[0]:row.parent_id)===original.odoo_message_id))return cancel(action,'TEAM_ALREADY_REPLIED');
   }
   if((await teamCheck({messageId:id,date:source.date,from:source.from})).handled)return cancel(action,'TEAM_ALREADY_REPLIED');
   log(JSON.stringify({event:'draft_verification',action_id:action.id,status:'verified',source:original.source||'aruba'}));return true;
  }catch(error){const reason=/^[a-z][a-z0-9_]{0,99}$/.test(error?.code||'')?error.code:'verification_unavailable';store.audit('AUTO_DRAFT_VERIFICATION_DEFERRED',{action_id:action.id,reason});log(JSON.stringify({event:'draft_verification',action_id:action.id,status:'deferred',reason}));throw Object.assign(Error(reason),{code:reason});}
 };
}
