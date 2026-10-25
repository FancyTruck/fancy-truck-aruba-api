import {problem} from './peuCommon.js';
const id={type:'integer',minimum:1};
const list={type:'object',properties:{query:{type:'string',minLength:1,maxLength:200},partner_id:id,limit:{type:'integer',minimum:1,maximum:20}},required:[],additionalProperties:false};
export const odooReadDefinitions={
 'crm.list':{effect:'read',parameters:list},
 'sales.list':{effect:'read',parameters:list},
 'sales.get':{effect:'read',parameters:{type:'object',properties:{id},required:['id'],additionalProperties:false}}
};
// Fixed models, fields and method: neither the model nor retrieved records can issue writes.
export async function readOdoo(read,capability,p){
 if(!read)throw problem('odoo_read_unconfigured',503);
 const sales=capability.startsWith('sales.'),model=sales?'sale.order':'crm.lead';
 const fields=sales?['id','name','partner_id','state','date_order','amount_total','currency_id','user_id']:['id','name','partner_id','stage_id','expected_revenue','probability','date_deadline','user_id'];
 const domain=[];if(p.partner_id)domain.push(['partner_id','=',p.partner_id]);
 if(p.query)domain.push(['name','ilike',p.query]);
 const single=capability==='sales.get',limit=single?1:(p.limit||10);
 if(single)domain.push(['id','=',p.id]);
 const rows=await read(model,domain,{fields,limit:limit+1,order:'id desc'});
 if(!Array.isArray(rows))throw problem('odoo_read_failed',502);
 const result={ok:true,source:'odoo',records:rows.slice(0,limit),has_more:rows.length>limit,checked_at:new Date().toISOString()};
 if(single&&rows.length){
  const lines=await read('sale.order.line',[['order_id','=',p.id]],{fields:['id','product_id','name','product_uom_qty','price_unit','price_subtotal'],limit:51,order:'id asc'});
  if(!Array.isArray(lines))throw problem('odoo_read_failed',502);
  result.lines=lines.slice(0,50);result.lines_has_more=lines.length>50;
 }
 return result;
}
