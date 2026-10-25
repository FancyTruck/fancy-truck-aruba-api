import {problem} from './peuCommon.js';
const id={type:'integer',minimum:1};
const list={type:'object',properties:{query:{type:'string',minLength:1,maxLength:200},partner_id:id,limit:{type:'integer',minimum:1,maximum:20}},required:[],additionalProperties:false};
export const odooReadDefinitions={
 'rentals.list':{effect:'read',parameters:{...list,properties:{...list.properties,scope:{type:'string',enum:['ongoing','current','upcoming','all_confirmed']},offset:{type:'integer',minimum:0,maximum:10000}}}},
 'crm.list':{effect:'read',parameters:list},
 'sales.list':{effect:'read',parameters:list},
 'sales.get':{effect:'read',parameters:{type:'object',properties:{id},required:['id'],additionalProperties:false}}
};
// Fixed models, fields and method: neither the model nor retrieved records can issue writes.
export async function readOdoo(read,capability,p,now=new Date()){
 if(!read)throw problem('odoo_read_unconfigured',503);
 const rental=capability==='rentals.list';
 const sales=rental||capability.startsWith('sales.'),model=sales?'sale.order':'crm.lead';
 const fields=sales?['id','name','partner_id','state','date_order','amount_total','currency_id','user_id','is_rental_order','rental_start_date','rental_return_date','signed_on']:['id','name','partner_id','stage_id','expected_revenue','probability','date_deadline','user_id'];
 const domain=[];if(p.partner_id)domain.push(['partner_id','=',p.partner_id]);
 if(p.query)domain.push(['name','ilike',p.query]);
 const single=capability==='sales.get',limit=single?1:(p.limit||10);
 if(single)domain.push(['id','=',p.id]);
 const scope=p.scope||'ongoing',stamp=now.toISOString().slice(0,19).replace('T',' ');
 if(rental){
  domain.push(['is_rental_order','=',true],['state','=','sale']);
  if(scope==='current')domain.push(['rental_start_date','<=',stamp],['rental_return_date','>',stamp]);
  if(scope==='upcoming')domain.push(['rental_start_date','>',stamp]);
  if(scope==='ongoing')domain.push('|',['rental_return_date','=',false],['rental_return_date','>',stamp]);
 }
 const rows=await read(model,domain,{fields,limit:limit+1,order:rental?'rental_start_date asc, id asc':'id desc',...(rental?{offset:p.offset||0}:{})});
 if(!Array.isArray(rows))throw problem('odoo_read_failed',502);
 const result={ok:true,source:'odoo',records:rows.slice(0,limit),has_more:rows.length>limit,checked_at:new Date().toISOString()};
 if(rental){
  result.scope=scope;result.next_offset=result.has_more?(p.offset||0)+limit:null;
  result.meaning='Ordini di noleggio confermati in Odoo. Le date indicano il periodo programmato, non provano consegna o restituzione. signed_on è la data firma registrata, se disponibile. Nessun contratto PDF letto.';
  const ids=result.records.map(r=>r.id);
  const lines=ids.length?await read('sale.order.line',[['order_id','in',ids],['is_rental','=',true]],{fields:['id','order_id','product_id','name','product_uom_qty'],limit:201,order:'id asc'}):[];
  if(!Array.isArray(lines))throw problem('odoo_read_failed',502);
  result.rental_lines=lines.slice(0,200);result.lines_has_more=lines.length>200;
  result.records=result.records.map(r=>({...r,period_status:!r.rental_start_date||!r.rental_return_date?'dates_missing':r.rental_start_date>stamp?'upcoming':r.rental_return_date<=stamp?'ended':'current'}));
 }
 if(single&&rows.length){
  const lines=await read('sale.order.line',[['order_id','=',p.id]],{fields:['id','product_id','name','product_uom_qty','price_unit','price_subtotal'],limit:51,order:'id asc'});
  if(!Array.isArray(lines))throw problem('odoo_read_failed',502);
  result.lines=lines.slice(0,50);result.lines_has_more=lines.length>50;
 }
 return result;
}
