// A quotation number is evidence, never permission to attach another customer's mail.
export function quotationReferences(subject = '', text = '') {
 return [...new Set((`${subject}\n${text}`.match(/\bS\d{5,}\b/gi)||[]).map(s=>s.toUpperCase()))];
}

export async function matchQuotationThread({subject,text,partnerIds,call}) {
 const references=quotationReferences(subject,text);
 if(!references.length)return null;
 if(!partnerIds.length)return {ambiguous:true,candidate_ids:[],reason:'quotation_sender_unverified'};
 const orders=await call('sale.order','search_read',[[['name','in',references],['partner_id','in',partnerIds]]],
  {fields:['name','partner_id','opportunity_id'],limit:101});
 const found=new Set(orders.map(o=>o.name));
 // Every explicit reference must resolve. Never silently pick one out of two quotes.
 if(orders.length>=101||references.some(ref=>!found.has(ref)))return {ambiguous:true,candidate_ids:[],reason:'quotation_reference_unresolved'};
 const ids=[...new Set(orders.map(o=>Array.isArray(o.opportunity_id)?o.opportunity_id[0]:o.opportunity_id).filter(Boolean))];
 if(ids.length!==1||orders.some(o=>!o.opportunity_id))return {ambiguous:true,candidate_ids:ids,reason:'quotation_link_requires_review'};
 const leads=await call('crm.lead','search_read',[[['id','=',ids[0]],['active','=',true]]],
  {fields:['name','description','partner_id','stage_id','create_date'],limit:1});
 if(leads.length!==1)return {ambiguous:true,candidate_ids:ids,reason:'quotation_case_inactive'};
 const orderIds=orders.map(o=>o.id);
 const fields=await call('ir.model.fields','search_read',[[['model','=','project.project'],['name','=','sale_order_id']]],{fields:['name'],limit:1});
 const projects=fields.some(f=>f.name==='sale_order_id')
  ? await call('project.project','search_read',[[['sale_order_id','in',orderIds],['partner_id','in',partnerIds]]],{fields:['id'],limit:100}) : [];
 return {lead:leads[0],ambiguous:false,order_ids:orderIds,project_ids:projects.map(p=>p.id),evidence:'quotation_reference_and_customer'};
}
