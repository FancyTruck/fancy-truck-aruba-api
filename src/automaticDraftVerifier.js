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
   const recipient=address(action.payload.to||action.target),senders=(source.from||[]).map(a=>String(a.address||'').toLowerCase());
   if(!recipient||!senders.includes(recipient))incomplete('draft_source_recipient_mismatch');
   if(['supplier_offer','administrative_or_marketing','automatic_or_mailing_list','automatic_service_notification'].includes(decision.reason))return cancel(action,'NOT_CUSTOMER_REQUEST');
   if(decision.reason==='non_customer_direction_requires_review')incomplete('draft_commercial_context_required');
   if(!decision.kind||decision.kind==='unknown'){
    // A customer's factual follow-up need not repeat the original rental intent.
    // Only the exact active opportunity and customer can supply that context.
    const caseId=Number(/^odoo-lead-(\d+)$/.exec(action.case_id||'')?.[1]||original.case_id);
    if(!Number.isSafeInteger(caseId)||caseId<1||(original.case_id&&original.case_id!==caseId))incomplete('draft_commercial_context_required');
    const leads=await odooRead('crm.lead',[['id','=',caseId],['active','=',true],['type','=','opportunity']],{fields:['id','name','description','email_from','partner_id'],limit:2});
    if(leads.length!==1||leads[0].id!==caseId)incomplete('draft_commercial_context_required');
    const lead=leads[0];let sameCustomer=address(lead.email_from)===recipient;
    const partnerId=Array.isArray(lead.partner_id)?lead.partner_id[0]:lead.partner_id;
    if(!sameCustomer&&Number.isSafeInteger(partnerId)){
     const partners=await odooRead('res.partner',[['id','=',partnerId]],{fields:['email'],limit:2});
     sameCustomer=partners.length===1&&address(partners[0].email)===recipient;
    }
    const context=classify(lead.name,lead.description||'');
    if(!sameCustomer||!context.kind||context.kind==='unknown'||['supplier_offer','non_customer_direction_requires_review','administrative_or_marketing','automatic_or_mailing_list','automatic_service_notification'].includes(context.reason))incomplete('draft_commercial_context_required');
   }
   // Odoo can retain the received message even after it leaves Aruba INBOX.
   // A later customer answer supersedes an old automatic request for details.
   let unverifiedTeamReply=false;
   if(original.source==='odoo_received'){
    const rows=await odooRead('mail.message',[['model','=','crm.lead'],['res_id','=',original.case_id],['message_type','=','email'],['id','>',original.odoo_message_id]],{fields:['email_from','parent_id','date'],order:'id asc',limit:101});
    if(rows.length>100)incomplete('draft_thread_verification_incomplete');
    const customer=String(source.from?.[0]?.address||'').toLowerCase();
    if(rows.some(row=>address(row.email_from)===customer))return cancel(action,'CUSTOMER_REPLIED_AFTER_SOURCE');
    unverifiedTeamReply=rows.some(row=>address(row.email_from).endsWith('@fancytruck.it')&&(Array.isArray(row.parent_id)?row.parent_id[0]:row.parent_id)===original.odoo_message_id);
   }
   if((await teamCheck({messageId:id,date:source.date,from:source.from})).handled)return cancel(action,'TEAM_ALREADY_REPLIED');
   // Odoo ancestry alone has no recipient or delivery evidence. Preserve the
   // draft for review unless the mailbox check proves an answer to this customer.
   if(unverifiedTeamReply)incomplete('draft_team_reply_unverified');
   log(JSON.stringify({event:'draft_verification',action_id:action.id,status:'verified',source:original.source||'aruba'}));return true;
  }catch(error){const reason=/^[a-z][a-z0-9_]{0,99}$/.test(error?.code||'')?error.code:'verification_unavailable';store.audit('AUTO_DRAFT_VERIFICATION_DEFERRED',{action_id:action.id,reason});log(JSON.stringify({event:'draft_verification',action_id:action.id,status:'deferred',reason}));throw Object.assign(Error(reason),{code:reason});}
 };
}
