import {hash,problem} from './peuCommon.js';
import {customerTag} from './customerActions.js';
const ref=x=>Array.isArray(x)?x[0]:x||null;
const clone=x=>structuredClone(x);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T12:00:00Z'))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
function instant(x){if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(x)||!Number.isFinite(Date.parse(x)))throw problem('quote_timestamp_requires_timezone');return new Date(x).toISOString().slice(0,19).replace('T',' ');}
const same=(a,b)=>hash(a)===hash(b);
const printedDate=x=>{if(!x)return '';const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(x.replace(' ','T')+'Z')).map(p=>[p.type,p.value]));return p.day+'/'+p.month+'/'+p.year+' '+p.hour+':'+p.minute;};
const monetaryKeys=['quantity','price_unit','discount','product_id'];
export class QuoteUpdate{
 constructor({read,write,fields}){Object.assign(this,{read,write,fields});this.locks=new Set();this.schemas=new Map();}
 async schema(model){if(!this.schemas.has(model)){if(!this.fields)throw problem('quote_schema_unavailable',503);this.schemas.set(model,await this.fields(model));}return this.schemas.get(model);}
 async list(opportunity){const leads=await this.read('crm.lead',[['id','=',opportunity],['active','=',true],['tag_ids.name','=',customerTag]],{fields:['id','name'],limit:2});if(leads.length!==1)throw problem('quote_customer_not_verified',409);const rows=await this.read('sale.order',[['opportunity_id','=',opportunity],['state','in',['draft','sent']]],{fields:['id','name','state','partner_id','amount_total','currency_id','rental_start_date','rental_return_date'],limit:21,order:'id desc'});return {ok:true,records:rows.slice(0,20),has_more:rows.length>20,customer:leads[0].name};}
 async snapshot(id,opportunity){
  const lead=await this.read('crm.lead',[['id','=',opportunity],['active','=',true],['tag_ids.name','=',customerTag]],{fields:['id','name','partner_id'],limit:2});if(lead.length!==1)throw problem('quote_customer_not_verified',409);
  const os=await this.schema('sale.order'),ls=await this.schema('sale.order.line');const pick=(schema,names)=>names.filter(x=>schema[x]);
  const orderFields=pick(os,['id','name','state','partner_id','opportunity_id','company_id','currency_id','pricelist_id','fiscal_position_id','is_rental_order','rental_start_date','rental_return_date','validity_date','note','write_date','order_line','amount_untaxed','amount_tax','amount_total','signed_on','signed_by','invoice_count']);
  for(const f of ['state','partner_id','opportunity_id','write_date','order_line','amount_total','invoice_count','signed_on','signed_by'])if(!os[f])throw problem('quote_schema_unsupported',503);
  const rows=await this.read('sale.order',[['id','=',id]],{fields:orderFields,limit:2});if(rows.length!==1)throw problem('quote_not_found',404);const order=rows[0];
  if(ref(order.opportunity_id)!==opportunity||ref(order.partner_id)!==ref(lead[0].partner_id))throw problem('quote_not_linked_to_customer',409);
  if(!['draft','sent'].includes(order.state)||order.signed_on||order.signed_by||Number(order.invoice_count||0)>0)throw problem('quote_not_editable',409);
  if(os.signature&&(await this.read('sale.order',[['id','=',id],['signature','!=',false]],{fields:['id'],limit:1})).length)throw problem('quote_signed_not_editable',409);
  const taxField=ls.tax_ids?'tax_ids':ls.tax_id?'tax_id':null,uomField=ls.product_uom_id?'product_uom_id':ls.product_uom?'product_uom':null;
  const lines=await this.read('sale.order.line',[['order_id','=',id]],{fields:pick(ls,['id','order_id','sequence','display_type','product_id','name','product_uom_qty','price_unit','discount','price_subtotal','price_tax','price_total','qty_invoiced','qty_delivered','write_date',taxField,uomField].filter(Boolean)),limit:201,order:'sequence asc,id asc'});
  if(lines.length>200||lines.length!==(order.order_line||[]).length)throw problem('quote_lines_incomplete',409);
  for(const f of ['qty_invoiced','qty_delivered','price_unit','product_uom_qty','discount'])if(!ls[f])throw problem('quote_schema_unsupported',503);
  if(lines.some(l=>!l.display_type&&['price_unit','product_uom_qty','discount'].some(f=>!Number.isFinite(l[f]))))throw problem('quote_line_values_unverified',409);
  if(!Number.isFinite(order.amount_total))throw problem('quote_total_unverified',409);
  if(lines.some(l=>Number(l.qty_invoiced||0)!==0||Number(l.qty_delivered||0)!==0))throw problem('quote_fulfillment_started',409);
  return {order,lines,lead:lead[0],taxField,uomField,revision:hash({order,lines})};
 }
 async preview(p){
  const before=await this.snapshot(p.id,p.opportunity_id),after=clone(before),changes=p.changes;
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(k=>!['rental_start_date','rental_return_date','validity_date','note','lines'].includes(k)))throw problem('quote_changes_invalid');
  const values={},diff=[];for(const key of ['rental_start_date','rental_return_date'])if(key in changes){if(!before.order.is_rental_order)throw problem('quote_not_rental');values[key]=instant(changes[key]);if(values[key]!==before.order[key]){after.order[key]=values[key];diff.push({field:key,before:before.order[key],after:values[key]});}}
  if(('rental_start_date'in values||'rental_return_date'in values)&&(!after.order.rental_start_date||!after.order.rental_return_date||after.order.rental_start_date>=after.order.rental_return_date))throw problem('quote_invalid_rental_period');
  if('validity_date'in changes){if(!date(changes.validity_date))throw problem('quote_invalid_validity_date');values.validity_date=changes.validity_date;after.order.validity_date=changes.validity_date;if(values.validity_date!==before.order.validity_date)diff.push({field:'validity_date',before:before.order.validity_date,after:values.validity_date});}
  if('note'in changes){if(typeof changes.note!=='string'||changes.note.length>10000)throw problem('quote_invalid_note');values.note=changes.note;after.order.note=changes.note;if(values.note!==(before.order.note||''))diff.push({field:'note',before:before.order.note||'',after:values.note});}
  const commands=[],used=new Set();let moneyChanged=false;
  if('lines'in changes&&(!Array.isArray(changes.lines)||changes.lines.length<1||changes.lines.length>100))throw problem('quote_lines_invalid');
  for(const change of changes.lines||[]){if(!Number.isSafeInteger(change.id)||used.has(change.id)||Object.keys(change).some(k=>!['id','name',...monetaryKeys].includes(k)))throw problem('quote_line_change_invalid');used.add(change.id);const old=before.lines.find(l=>l.id===change.id),line=after.lines.find(l=>l.id===change.id);if(!old)throw problem('quote_line_not_in_order',409);const edit={};
   for(const key of ['quantity','price_unit','discount'])if(key in change){if(old.display_type||typeof change[key]!=='number'||!Number.isFinite(change[key])||change[key]<0||(key==='discount'&&change[key]>100))throw problem('quote_line_value_invalid');const field=key==='quantity'?'product_uom_qty':key;edit[field]=change[key];line[field]=change[key];}
   if('name'in change){if(typeof change.name!=='string'||!change.name.trim()||change.name.length>10000)throw problem('quote_line_name_invalid');edit.name=change.name;line.name=change.name;}
   if('product_id'in change){if(old.display_type||!Number.isSafeInteger(change.product_id)||change.product_id<1||!('price_unit'in change)||!('quantity'in change))throw problem('quote_product_requires_price_and_quantity');const product=(await this.read('product.product',[['id','=',change.product_id],['active','=',true],['sale_ok','=',true]],{fields:['id','name','display_name','taxes_id','uom_id','company_id'],limit:2}))[0];if(!product||(ref(product.company_id)&&ref(product.company_id)!==ref(before.order.company_id)))throw problem('quote_product_not_eligible',409);if(!before.taxField||!before.uomField||ref(product.uom_id)!==ref(old[before.uomField])||!same([...(product.taxes_id||[])].sort(),[...(old[before.taxField]||[])].sort()))throw problem('quote_product_tax_or_unit_requires_review',409);edit.product_id=product.id;line.product_id=[product.id,product.display_name||product.name];if(!('name'in change)){edit.name=product.display_name||product.name;line.name=edit.name;}}
   const actual=Object.fromEntries(Object.entries(edit).filter(([k,v])=>k==='product_id'?ref(old.product_id)!==v:old[k]!==v));if(!Object.keys(actual).length)continue;commands.push([1,change.id,actual]);moneyChanged ||= Object.keys(change).some(k=>monetaryKeys.includes(k));diff.push({field:'line',id:change.id,before:old,after:line});
  }
  const periodChanged=diff.some(d=>['rental_start_date','rental_return_date'].includes(d.field));
  if(periodChanged){const oldPeriod=printedDate(before.order.rental_start_date)+' al '+printedDate(before.order.rental_return_date),newPeriod=printedDate(after.order.rental_start_date)+' al '+printedDate(after.order.rental_return_date);for(const line of after.lines){if(line.display_type||!line.product_id)continue;let command=commands.find(c=>c[1]===line.id);if(!command){command=[1,line.id,{}];commands.push(command);}for(const f of ['price_unit','product_uom_qty','discount'])if(!(f in command[2])&&Number.isFinite(line[f]))command[2][f]=line[f];if(!('name'in command[2])&&String(line.name||'').includes(oldPeriod)){const old=before.lines.find(l=>l.id===line.id);line.name=line.name.replaceAll(oldPeriod,newPeriod);command[2].name=line.name;diff.push({field:'line',id:line.id,before:old,after:line});}}}
  if(!diff.length)throw problem('quote_no_changes',409);
  if(moneyChanged){const totals=await this.totals(after);Object.assign(after.order,totals);}if(commands.length)values.order_line=commands;
  const preview_hash=hash({revision:before.revision,values,after:after.order,lines:after.lines});return {ok:true,status:'preview',quote_id:before.order.id,quote_name:before.order.name,customer:before.lead.name,revision:before.revision,preview_hash,before:{order:before.order,lines:before.lines},after:{order:after.order,lines:after.lines},differences:diff,availability_verified:false,pricing_policy:periodChanged?'Prezzi mantenuti salvo modifiche esplicite. Verificare la tariffa per la nuova durata.':'Modifiche economiche limitate ai valori mostrati.',customer_send:false,parameters:{id:p.id,opportunity_id:p.opportunity_id,revision:before.revision,preview_hash,changes:clone(changes)},write_values:values};
 }
 async totals(snapshot){
  if(!snapshot.taxField)throw problem('quote_tax_preview_unavailable',409);const currencies=await this.read('res.currency',[['id','=',ref(snapshot.order.currency_id)]],{fields:['rounding'],limit:1}),companies=await this.read('res.company',[['id','=',ref(snapshot.order.company_id)]],{fields:['tax_calculation_rounding_method'],limit:1});const step=currencies[0]?.rounding;if(!Number.isFinite(step)||step<=0||companies[0]?.tax_calculation_rounding_method!=='round_per_line')throw problem('quote_tax_preview_unavailable',409);const round=x=>Math.round((x+Number.EPSILON)/step)*step;let untaxed=0,tax=0;
  const ids=[...new Set(snapshot.lines.flatMap(l=>l[snapshot.taxField]||[]))],taxes=ids.length?await this.read('account.tax',[['id','in',ids]],{fields:['id','amount_type','amount','price_include','include_base_amount'],limit:ids.length+1}):[];
  if(ids.some(id=>!taxes.some(t=>t.id===id))||taxes.some(t=>t.amount_type!=='percent'||t.price_include||t.include_base_amount))throw problem('quote_tax_preview_requires_review',409);
  for(const l of snapshot.lines){if(l.display_type)continue;const base=round(l.product_uom_qty*l.price_unit*(1-(l.discount||0)/100));const amount=round((l[snapshot.taxField]||[]).reduce((n,id)=>n+base*taxes.find(t=>t.id===id).amount/100,0));l.price_subtotal=base;l.price_tax=amount;l.price_total=round(base+amount);untaxed+=base;tax+=amount;}return {amount_untaxed:round(untaxed),amount_tax:round(tax),amount_total:round(untaxed+tax)};
 }
 async apply(p){
  if(!this.write)throw problem('quote_update_unavailable',503);if(this.locks.has(p.id))throw problem('quote_update_busy',409);this.locks.add(p.id);
  try{const proposed=await this.preview(p);if(proposed.revision!==p.revision||proposed.preview_hash!==p.preview_hash)throw problem('quote_changed_refresh_preview',409);
   // One ORM write applies the selected order fields and line commands together. Never confirms or sends the quotation.
   const result=await this.write('sale.order','write',[[p.id],proposed.write_values]);if(result!==true)throw problem('quote_write_unverified',502);
   const current=await this.snapshot(p.id,p.opportunity_id);for(const [k,v]of Object.entries(proposed.write_values)){if(k==='order_line'){for(const [,id,fields]of v){const line=current.lines.find(l=>l.id===id);if(!line||Object.entries(fields).some(([f,value])=>f==='product_id'?ref(line[f])!==value:line[f]!==value))throw problem('quote_update_unverified',502);}}else if((current.order[k]||'')!==(v||''))throw problem('quote_update_unverified',502);}
   if((!Number.isFinite(current.order.amount_total)||!Number.isFinite(proposed.after.order.amount_total)||Math.abs(current.order.amount_total-proposed.after.order.amount_total)>0.011))throw problem('quote_total_verification_failed',502);
   return {ok:true,status:'quote_updated',id:p.id,name:current.order.name,revision:current.revision,amount_total:current.order.amount_total,currency:current.order.currency_id,customer_send:false,order_confirmed:false,availability_verified:false};
  }finally{this.locks.delete(p.id);}
 }
}
