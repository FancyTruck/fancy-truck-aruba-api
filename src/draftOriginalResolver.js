// An Odoo copy is accepted only by exact RFC identity, case and customer sender.
// Subjects and dates alone never identify an original.
export function draftOriginalResolver({readMailbox,actions,odooRead,plainText}) {
 return async(account,messageId)=>{
  const mailbox=await readMailbox(account,messageId);if(mailbox?.original?.payload?.text)return mailbox;
  const candidates=Object.values(actions()).filter(a=>a.type==='SEND_EMAIL'&&a.payload?.account===account&&a.payload?.inReplyTo===messageId&&/^odoo-lead-\d+$/.test(a.case_id||''));
  const ids=[...new Set(candidates.map(a=>Number(a.case_id.slice(10))))];if(!ids.length)return mailbox;
  const rows=await odooRead('mail.message',[['model','=','crm.lead'],['res_id','in',ids],['message_id','=',messageId],['message_type','=','email']],{fields:['id','res_id','message_id','email_from','subject','body','date','message_type'],limit:2});
  if(rows.length!==1)return {original:null};const m=rows[0];if(m.message_id!==messageId||!ids.includes(m.res_id))return {original:null};
  const match=String(m.email_from||'').match(/<([^<>\s]+@[^<>\s]+)>|^([^<>\s]+@[^<>\s]+)$/),sender=String(match?.[1]||match?.[2]||'').toLowerCase();
  if(!sender||sender.endsWith('@fancytruck.it')||!candidates.some(a=>Number(a.case_id.slice(10))===m.res_id&&String(a.payload.to||a.target||'').toLowerCase()===sender))return {original:null};
  const text=plainText(m.body||'');if(!text.trim()||text.length>1024*1024)return {original:null};
  return {original:{message_id:messageId,folder:'ODOO',source:'odoo_received',odoo_message_id:m.id,case_id:m.res_id,payload:{subject:m.subject||'',text,text_truncated:false,date:m.date?new Date(String(m.date).replace(' ','T')+'Z').toISOString():null,from:[{address:sender}]}}};
 };
}
