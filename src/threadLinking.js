import crypto from 'node:crypto';
const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function linkThreadMessage({parsed,match,direction,call,store}) {
 if(!parsed.messageId)throw Error('Message-ID mancante: collegamento da verificare');
 const digest=crypto.createHash('sha256').update(parsed.messageId.trim()).digest('hex');
 const marker=`FANCY-THREAD:${digest}`;
 const targets=[['crm.lead',match.lead.id],...(match.order_ids||[]).map(id=>['sale.order',id]),...(match.project_ids||[]).map(id=>['project.project',id])];
 const existing=await call('mail.message','search_read',[[['message_id','=',parsed.messageId],['model','in',['crm.lead','sale.order','project.project']]]],{fields:['model','res_id'],limit:100});
 for(const [model,id] of targets){
  if(existing.some(m=>m.model===model&&m.res_id===id))continue;
  const notes=await call('mail.message','search_count',[[['model','=',model],['res_id','=',id],['body','ilike',marker]]]);
  if(notes)continue;
  await call(model,'message_post',[[id]],{
   body:`<p><strong>Email ${direction==='outgoing'?'inviata':'ricevuta'} collegata da Fancy AI</strong></p><p>Oggetto: ${escape(parsed.subject)}<br>Da: ${escape(parsed.from?.value?.map(v=>v.address).join(', '))}<br>A: ${escape(parsed.to?.value?.map(v=>v.address).join(', '))}</p><pre>${escape(String(parsed.text||'').slice(0,16000))}</pre><p>Riferimento: ${marker}</p>`,
   message_type:'comment',subtype_xmlid:'mail.mt_note',partner_ids:[],
  });
 }
 store.audit('EMAIL_THREAD_LINKED',{lead_id:match.lead.id,order_ids:match.order_ids||[],direction,message_digest:digest});
 return {linked:true,lead_id:match.lead.id,order_ids:match.order_ids||[],direction};
}
