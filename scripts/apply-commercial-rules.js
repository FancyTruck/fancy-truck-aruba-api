// Explicitly authorized configuration change: 22% sales tax except deposits,
// payment on confirmation and vehicle-specific deposit returned within 30 days.
// Historical orders are never modified. Only test draft 331 is updated.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {depositAmount,rentalTerms,isDepositProduct,PAYMENT_TERM_NAME} from '../src/commercialTerms.js';
const apply=process.argv.includes('--apply');
const reportPath='/var/data/fancy-commercial-rules-20261021.json';
const report={at:new Date().toISOString(),status:'PREFLIGHT',changes:[]};
let owned=false;
const save=()=>{fs.writeFileSync(reportPath+'.tmp',JSON.stringify(report,null,2),{mode:0o600});fs.renameSync(reportPath+'.tmp',reportPath);};
async function api(model,method,body){
 assert(['search_read','write','create'].includes(method));
 if(method!=='search_read'){
  assert(apply&&owned,'Scritture solo dopo backup');
  assert(['product.template','sale.order.template','sale.order','sale.order.line','account.payment.term'].includes(model));
  if(method==='create')assert.equal(model,'account.payment.term');
  if(model==='sale.order')assert.deepEqual(body.ids,[331]);
  if(model==='sale.order.line')assert(body.ids.every(id=>report.orderLines.some(l=>l.id===id)));
  report.changes.push({model,method,body,status:'ATTEMPTING'});save();
 }
 const response=await fetch(`${process.env.ODOO_URL.replace(/\/$/,'')}/json/2/${model}/${method}`,{method:'POST',headers:{authorization:`bearer ${process.env.ODOO_API_KEY}`,'x-odoo-database':process.env.ODOO_DB,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`${model}.${method}: HTTP ${response.status}`);
 const result=await response.json();
 if(method!=='search_read'){report.changes.at(-1).status='DONE';report.changes.at(-1).result=result;save();}
 return result;
}
const read=(model,domain,fields,limit=500)=>api(model,'search_read',{domain,fields,limit});
async function fields(model){return (await read('ir.model.fields',[['model','=',model]],['name'],1000)).map(f=>f.name);}
const write=(model,ids,vals)=>api(model,'write',{ids,vals});
try{
 process.umask(0o077);
 if(apply)assert(!fs.existsSync(reportPath),'Aggiornamento già avviato: leggere report, non ripetere');
 const order=(await read('sale.order',[['id','=',331]],['name','state','partner_id','company_id','payment_term_id','note','sale_order_template_id'],2))[0];
 assert(order&&order.state==='draft'&&order.partner_id[0]===464&&order.name==='S00331');report.order=order;
 const companyId=order.company_id[0];
 const pf=await fields('product.template');
 assert(pf.includes('taxes_id')&&pf.includes('company_id')&&pf.includes('rent_ok'));
 const products=await read('product.template',['&','|',['sale_ok','=',true],['rent_ok','=',true],'|',['company_id','=',false],['company_id','=',companyId]],['name','taxes_id','description_sale','company_id','sale_ok','rent_ok']);
 assert(products.length>0&&products.length<500,'Catalogo incompleto');report.products=products;
 const logistics=products.find(p=>p.id===7);assert(logistics?.taxes_id.length,'Imposta logistica non disponibile');
 const taxFields=await fields('account.tax');assert(taxFields.includes('company_id'));
 const taxes=await read('account.tax',[['id','in',logistics.taxes_id]],['name','amount','amount_type','type_tax_use','company_id',...(taxFields.includes('price_include')?['price_include']:[])]);
 const standard=taxes.filter(t=>t.amount===22&&t.amount_type==='percent'&&t.type_tax_use==='sale'&&t.company_id[0]===companyId&&t.price_include!==true);
 assert.equal(taxes.length,1,'La logistica usa imposte multiple: revisione richiesta');assert.equal(standard.length,1,'IVA22 standard non identificata');report.tax=standard[0];
 assert(!products.some(p=>/cauzion|security deposit/i.test(p.name)&&!isDepositProduct(p.name)),'Nome cauzione ambiguo: classificare prima di aggiornare');
 const existingTaxIds=[...new Set(products.flatMap(p=>p.taxes_id))];
 const allTaxes=await read('account.tax',[['id','in',existingTaxIds]],['company_id'],1000);
 assert.equal(allTaxes.length,existingTaxIds.length,'Imposte di altre aziende non leggibili: non sovrascrivere');
 const taxCompanies=new Map(allTaxes.map(t=>[t.id,t.company_id[0]]));
 const desiredTaxes=p=>[...p.taxes_id.filter(id=>taxCompanies.get(id)!==companyId),...(isDepositProduct(p.name)?[]:[report.tax.id])].sort((a,b)=>a-b);

 const tf=await fields('sale.order.template');
 const templates=await read('sale.order.template',[['name','ilike','Noleggio']],['name','note',...(tf.includes('payment_term_id')?['payment_term_id']:[]),...(tf.includes('company_id')?['company_id']:[])]);
 assert(templates.length<500);report.templates=templates.filter(t=>!t.company_id||t.company_id[0]===companyId);
 const lf=await fields('sale.order.line');const lineTax=lf.includes('tax_ids')?'tax_ids':lf.includes('tax_id')?'tax_id':null;assert(lineTax);report.lineTaxField=lineTax;
 report.orderLines=await read('sale.order.line',[['order_id','=',331]],['name','product_id',lineTax,'product_uom_qty','price_unit']);
 const vehicle=(await read('product.product',[['id','=',40]],['description_sale'],2))[0];const deposit=depositAmount(vehicle?.description_sale);assert.equal(deposit,3000,'Cauzione Airstream non confermata');
 const paymentFields=await fields('account.payment.term');const paymentLineFields=await fields('account.payment.term.line');
 assert(paymentFields.includes('company_id')&&paymentFields.includes('line_ids'));
 assert(['value','value_amount','nb_days'].every(f=>paymentLineFields.includes(f)),'Schema scadenze non supportato');
 const terms=await read('account.payment.term',[['name','=',PAYMENT_TERM_NAME],['company_id','=',companyId]],['name','line_ids'],2);assert(terms.length<=1);report.existingTerms=terms;
 if(terms.length){
  const termLines=await read('account.payment.term.line',[['id','in',terms[0].line_ids]],['value','value_amount','nb_days',...(paymentLineFields.includes('delay_type')?['delay_type']:[])]);
  assert.equal(termLines.length,1);assert(termLines[0].value==='balance'||termLines[0].value==='percent'&&termLines[0].value_amount===100);assert.equal(termLines[0].nb_days,0);assert(!termLines[0].delay_type||termLines[0].delay_type==='days_after');
 }
 // Validate new notes before the first mutation.
 const orderNote=rentalTerms(order.note,deposit);
 const templateNotes=report.templates.map(t=>({id:t.id,note:rentalTerms(t.note,null)}));
 report.plan={productChanges:products.filter(p=>JSON.stringify([...p.taxes_id].sort((a,b)=>a-b))!==JSON.stringify(desiredTaxes(p))).map(p=>({id:p.id,name:p.name,tax_ids:desiredTaxes(p)})),templateIds:templateNotes.map(t=>t.id),testOrder:331,deposit};
 console.log('PIANO:',JSON.stringify(report.plan));
 if(!apply){console.log('SOLA LETTURA: nessuna modifica');process.exit(0);}
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});owned=true;
 let termId=terms[0]?.id;
 if(!termId){
  const line={value:'percent',value_amount:100,nb_days:0};if(paymentLineFields.includes('delay_type'))line.delay_type='days_after';
  const ids=await api('account.payment.term','create',{vals_list:[{name:PAYMENT_TERM_NAME,company_id:companyId,line_ids:[[0,0,line]]}]});termId=Array.isArray(ids)?ids[0]:ids;
 }
 report.paymentTermId=termId;save();
 for(const p of report.plan.productChanges)await write('product.template',[p.id],{taxes_id:[[6,0,p.tax_ids]]});
 for(const t of templateNotes)await write('sale.order.template',[t.id],{note:t.note,...(tf.includes('payment_term_id')?{payment_term_id:termId}:{})});
 for(const line of report.orderLines.filter(l=>l.product_id)){
  const name=line.product_id[1];await write('sale.order.line',[line.id],{[lineTax]:[[6,0,isDepositProduct(name)?[]:[report.tax.id]]]});
 }
 await write('sale.order',[331],{note:orderNote,payment_term_id:termId});
 const updated=await read('product.template',[['id','in',products.map(p=>p.id)]],['name','taxes_id']);assert.equal(updated.length,products.length);
 for(const p of updated)assert.deepEqual([...p.taxes_id].sort((a,b)=>a-b),desiredTaxes(products.find(old=>old.id===p.id)));
 const checkedTemplates=await read('sale.order.template',[['id','in',templateNotes.map(t=>t.id)]],['name','note']);
 assert.equal(checkedTemplates.length,templateNotes.length);
 for(const t of checkedTemplates){assert(t.note.includes('saldo alla conferma'));assert(t.note.includes('30 giorni'));assert(!/acconto\s*50|\.\.\./i.test(t.note));}
 const verified=(await read('sale.order',[['id','=',331]],['name','state','note','payment_term_id','amount_untaxed','amount_tax','amount_total'],2))[0];
 assert.equal(verified.state,'draft');assert.equal(verified.payment_term_id[0],termId);assert.equal(verified.note,orderNote);
 assert.equal(verified.amount_untaxed,1764.08);assert(Math.abs(verified.amount_tax-388.10)<0.011);assert(Math.abs(verified.amount_total-2152.18)<0.011);
 report.verified=verified;report.status='VERIFIED';save();
 console.log(JSON.stringify({bozza:verified.name,imponibile:verified.amount_untaxed,iva:verified.amount_tax,totale:verified.amount_total,cauzione:deposit,prodotti_verificati:updated.length,invii:0,backup:reportPath}));
}catch(error){if(owned){report.status='INCOMPLETE_DO_NOT_RETRY';report.error=error.message;save();}console.error('CONTROLLO INCOMPLETO, NON RIPETERE:',error.message);process.exitCode=1;}
