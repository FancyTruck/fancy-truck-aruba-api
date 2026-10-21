// One-shot operational test, restricted to existing test lead 503.
// No production state changes, SMTP, confirmations or customer sends.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
const reportPath='/var/data/fancy-ai-rental-intake-test.json';
const statePath='/var/data/fancy-ai-rental-intake-state.json';
const sourceState='/var/data/fancy-collaudo-20261021.json';
const productionState='/var/data/fancy-truck-state.json';
const marker='FANCY-AI-ROUTED-INTAKE-20261021';
const email='grafichefancytruck@gmail.com';
const report={marker,status:'STARTED',at:new Date().toISOString(),created:{},routeMetres:[]};
const save=()=>{fs.writeFileSync(reportPath+'.tmp',JSON.stringify(report,null,2),{mode:0o600});fs.renameSync(reportPath+'.tmp',reportPath);};
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalFetch=globalThis.fetch;
const origin=new URL(process.env.ODOO_URL).origin;
async function read(model,domain,fields){
 const r=await originalFetch(`${origin}/json/2/${model}/search_read`,{method:'POST',headers:{authorization:`bearer ${process.env.ODOO_API_KEY}`,'x-odoo-database':process.env.ODOO_DB,'content-type':'application/json'},body:JSON.stringify({domain,fields,limit:20}),signal:AbortSignal.timeout(30000)});
 assert(r.ok,`Preflight ${model}: HTTP ${r.status}`);return r.json();
}
let app,ownedReport=false,productionHash;
try{
 process.umask(0o077);
 assert(!fs.existsSync(reportPath),'Collaudo già avviato: leggere il report, non ripetere');
 assert(!fs.existsSync(statePath),'Stato test già presente: non sovrascrivere');
 productionHash=hash(productionState);
 const leads=await read('crm.lead',[['id','=',503]],['name','email_from','partner_id','description','stage_id']);
 assert.equal(leads.length,1);const lead=leads[0];
 assert(lead.name.startsWith('[FANCY-AI-COLLAUDO-20261021 / NOLEGGIO]'));
 assert.equal(lead.email_from,email);assert(lead.partner_id);
 const partners=await read('res.partner',[['id','=',lead.partner_id[0]]],['name','email','property_product_pricelist']);
 assert.equal(partners.length,1);assert.equal(partners[0].name,'COLLAUDO FANCY AI');assert.equal(partners[0].email,email);assert.equal(partners[0].property_product_pricelist[0],1);
 report.partnerId=partners[0].id;
 assert.equal((await read('sale.order',[['opportunity_id','=',503]],['name','state'])).length,0,'Esiste già una bozza collegata: non duplicare');
 fs.writeFileSync(reportPath,JSON.stringify(report),{flag:'wx',mode:0o600});ownedReport=true;
 fs.copyFileSync(sourceState,statePath,fs.constants.COPYFILE_EXCL);
 Object.assign(process.env,{HOST:'127.0.0.1',PORT:'0',STATE_FILE:statePath,READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',AI_LOGISTICS_ENABLED:'true',ODOO_PARTNER_AUTOCOMPLETE:'false'});
 nodemailer.createTransport=()=>{throw Error('SMTP vietato nel collaudo');};
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);
  if(u.origin==='https://api.openai.com'){
   assert.equal(u.pathname,'/v1/responses');assert.equal(options.method,'POST');assert.equal(JSON.parse(options.body).store,false);
   return originalFetch(url,options);
  }
  if(u.origin==='https://api.openrouteservice.org'){
   assert(['/geocode/search','/v2/directions/driving-car'].includes(u.pathname));
   const r=await originalFetch(url,options);
   if(r.ok&&u.pathname.includes('/directions/')){const d=await r.clone().json();report.routeMetres.push(d.routes?.[0]?.summary?.distance);save();}
   return r;
  }
  assert.equal(u.origin,origin,'Destinazione fuori perimetro');
  const [model,method]=u.pathname.split('/').slice(-2),body=JSON.parse(options.body);
  if(!['search_read','search_count'].includes(method)){
   if(model==='crm.lead'){
    assert.deepEqual(body.ids,[503]);assert(['write','message_post'].includes(method));
    if(method==='write')assert(Object.keys(body.vals).every(key=>['description','stage_id','partner_id'].includes(key)));
    if(body.vals?.partner_id)assert.equal(body.vals.partner_id,report.partnerId);
    if(method==='message_post')assert.equal(body.subtype_xmlid,'mail.mt_note');
   }else{
    assert.equal(method,'create');assert.equal(body.vals_list.length,1);const v=body.vals_list[0];
    assert(!report.created[model],`Creazione ripetuta ${model}`);
    if(model==='sale.order'){
     assert.equal(v.opportunity_id,503);assert.equal(v.partner_id,report.partnerId);assert.equal(v.pricelist_id,1);
     assert.equal(v.is_rental_order,true);assert(!v.state||v.state==='draft');
     assert(v.origin.startsWith('[FANCY-AI-COLLAUDO-20261021 / NOLEGGIO]'));
     assert.equal(v.rental_start_date,'2026-12-20 09:00:00');assert.equal(v.rental_return_date,'2026-12-21 09:00:00');
     for(const [operation,id,line]of v.order_line){assert.equal(operation,0);assert.equal(id,0);assert(line.display_type==='line_note'||[7,40].includes(line.product_id));assert(!('price_unit'in line));}
     report.expectedLogistics=v.order_line.filter(line=>line[2].product_id===7).map(line=>line[2].product_uom_qty);
     assert.equal(report.expectedLogistics.length,2,'Nessuna bozza senza distanze complete');
     assert.equal(report.routeMetres.length,4);
     assert.deepEqual(report.expectedLogistics,[0,2].map(i=>Math.max(100,Math.round((report.routeMetres[i]+report.routeMetres[i+1])/10)/100)));
    }else if(model==='mail.activity'){assert.equal(v.res_id,503);assert(v.summary.startsWith('Controllare bozza'));}
    else if(model==='project.project'){assert.equal(v.partner_id,report.partnerId);assert(v.name.includes(lead.name));if(v.sale_order_id)assert.equal(v.sale_order_id,report.created['sale.order']);}
    else if(model==='project.task'){assert.equal(v.project_id,report.created['project.project']);assert.equal(v.partner_id,report.partnerId);assert.equal(v.name,'00 – RIEPILOGO ECONOMICO');}
    else assert.fail(`Scrittura vietata: ${model}.${method}`);
   }
   report.lastOperation={model,method,status:'ATTEMPTING'};save();
  }
  const response=await originalFetch(url,options);
  if(response.ok&&method==='create'){const ids=await response.clone().json();report.created[model]=Array.isArray(ids)?ids[0]:ids;save();}
  return response;
 };
 app=await import('../src/server.js');
 const result=await app.processQuoteReply({subject:lead.name,messageId:`<${marker}@fancytruck.test>`,from:{value:[{address:email,name:'COLLAUDO FANCY AI'}]},text:'COLLAUDO concordato, non confermare e non inviare preventivi. Noleggio Airstream Replica 4m dal 20/12/2026 ore 10:00 al 21/12/2026 ore 10:00. Consegna: Via Tortona 31, Milano. Ritiro allo stesso indirizzo della consegna. Personalizzazioni: nessuna. Attrezzature: nessuna. Allestimenti: nessuno. Richieste particolari: nessuna.'},marker,lead);
 report.result=result;save();assert.equal(result.ready_for_review,true);assert.equal(result.order_id,report.created['sale.order']);
 const orders=await read('sale.order',[['id','=',result.order_id]],['name','state','opportunity_id','is_rental_order']);
 assert.equal(orders.length,1);assert.equal(orders[0].state,'draft');assert.equal(orders[0].opportunity_id[0],503);report.order=orders[0];
 const lines=await read('sale.order.line',[['order_id','=',result.order_id]],['product_id','product_uom_qty','price_unit','is_rental','discount']);
 const logistics=lines.filter(l=>l.product_id?.[0]===7),rental=lines.filter(l=>l.product_id?.[0]===40);
 assert.equal(logistics.length,2);assert.deepEqual(logistics.map(l=>l.product_uom_qty).sort(),report.expectedLogistics.slice().sort());
 for(const line of logistics){assert.equal(line.price_unit,2);assert.equal(line.discount,0);assert.equal(line.is_rental,false);}
 assert.equal(rental.length,1);assert.equal(rental[0].is_rental,true);assert(rental[0].price_unit>0);
 assert.equal(hash(productionState),productionHash,'Stato produzione modificato');
 report.lines=lines;report.status='PASSED_DRAFT_REQUIRES_HUMAN_REVIEW';save();
 console.log(JSON.stringify({bozza:orders[0].name,pratica:503,quantita_logistica:report.expectedLogistics,prezzo_km:2,noleggio_odoo:rental[0].price_unit,stato:'draft',invii:0,stato_produzione_invariato:true}));
 console.log('PERCORSO REALE AI → MAPPE → BOZZA ODOO: OK; revisione mezzo e tariffa richiesta. Report:',reportPath);
}catch(error){
 if(ownedReport){report.status='INCOMPLETE_DO_NOT_RETRY';report.error=error.message;save();}
 console.error('COLLAUDO INCOMPLETO, NON RIPETERE:',error.message);process.exitCode=1;
}finally{
 globalThis.fetch=originalFetch;
 if(app)await new Promise(resolve=>app.server.close(resolve));
}
