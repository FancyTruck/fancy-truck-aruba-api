import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('four production intake paths use Odoo contract and approval queue without sending', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fancy-intake-'));
  Object.assign(process.env,{APP_ENV:'test',READ_ONLY:'false',AUTOMATION_ENABLED:'false',STARTUP_CHECKS:'false',
    STATE_FILE:path.join(directory,'state.json'),PORT:'0',API_TOKEN:'test-only',
    ODOO_URL:'https://odoo-contract.test',ODOO_DB:'test',ODOO_API_KEY:'test-only',ODOO_PARTNER_AUTOCOMPLETE:'false'});
  const realFetch=globalThis.fetch;
  let lead=null, orders=[], writes=[], counter=100;
  const partner={id:7,name:'Cliente Test',company_type:'company',property_product_pricelist:[1,'Default'],email:'cliente@example.test',vat:'IT12345678901',phone:'010000000',l10n_it_pec_email:'test@example.test',l10n_it_pa_index:'TEST123'};
  globalThis.fetch=async (url,options) => {
    assert.ok(String(url).startsWith('https://odoo-contract.test/json/2/'));
    const [model,method]=String(url).split('/').slice(-2), body=JSON.parse(options.body);
    let result;
    if (method==='search_read') {
      if (model==='res.partner') result=[partner];
      else if (model==='crm.lead') result=lead ? [lead] : [];
      else if (model==='crm.stage') result=[{id:1,name:'Nuove richieste'},{id:2,name:'Qualificate'}];
      else if (model==='sale.order') result=body.domain.some(term=>Array.isArray(term)&&term[0]==='id') ? orders : [];
      else if (model==='product.product') result=[{id:40,name:'Airstream Replica 4m XA855XY',sale_ok:false,rent_ok:true,list_price:50000}];
      else if (model==='res.users') result=[{id:1,name:'Pietro'}];
      else if (model==='ir.model') result=[{id:1,model:'crm.lead'}];
      else if (model==='mail.activity.type') result=[{id:1,name:'To do'}];
      else result=[];
    } else if (method==='search_count') result=0;
    else if (method==='create') {
      writes.push(model);const id=++counter;
      if (model==='crm.lead') lead={...body.vals_list[0],id};
      if (model==='sale.order') orders.push({...body.vals_list[0],id,name:`TEST-${id}`,state:'draft'});
      result=[id];
    } else if (method==='write') {
      if(model==='crm.lead') Object.assign(lead,body.vals); result=true;
    } else if (method==='message_post') result=++counter;
    else throw new Error(`Unexpected external operation: ${model}.${method}`);
    return {ok:true,json:async()=>result};
  };
  let app;
  t.after(async()=>{globalThis.fetch=realFetch;if(app) await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  app=await import('../src/server.js');if(!app.server.listening) await once(app.server,'listening');
  const cases=[
    {kind:'event_food',subject:'Partecipazione evento food',first:'Vorremmo partecipare al festival street food'},
    {kind:'catering',subject:'Richiesta catering',first:'Vorrei informazioni per un catering a Milano',reply:'Cena il 20/12/2026 a Milano per 80 ospiti, 4 ore e 2 foodtruck.'},
    {kind:'brand_activation',subject:'Richiesta brand activation',first:'Vorrei un preventivo brand activation',reply:'Airstream a Milano il 20/12/2026. Allestimenti: nessuno. Personalizzazioni: logo. Staff: nessuno. Gestione del servizio: nostra. Permessi: nostri. Adempimenti: nostri.'},
    {kind:'rental',subject:'Richiesta noleggio Airstream',first:'Vorrei noleggiare un Airstream',reply:'Dal 20/12/2026 al 21/12/2026, dalle 10:00 alle 18:00 a Milano. Personalizzazioni: nessuna. Attrezzature: nessuna. Allestimenti: nessuno. Richieste particolari: nessuna.'},
  ];
  for(const item of cases) await t.test(item.kind,async()=>{
    lead=null;orders=[];writes=[];
    const parsed={subject:item.subject,text:item.first,messageId:`<${item.kind}-first>`,from:{value:[{address:partner.email,name:'Cliente'}]}};
    const first=await app.processQuoteRequest(parsed,1,'hello','123');
    assert.equal(first.kind,item.kind);assert.equal(writes.filter(model=>model==='crm.lead').length,1);
    const actions=Object.values(app.store.state.actions).filter(action=>action.case_id===`odoo-lead-${lead.id}`);
    assert.equal(actions.length,1);assert.equal(actions[0].status,'PENDING_APPROVAL');
    assert.equal(actions[0].payload.subject, `Re: ${parsed.subject}`);
    assert.equal(actions[0].payload.inReplyTo, parsed.messageId);
    assert.equal(actions[0].payload.references, parsed.messageId);
    assert.throws(()=>app.approvals.assertExecutable(actions[0].id));
    if(item.kind==='event_food') {
      assert.match(actions[0].payload.html,/cristiano@fancytruck.it/);assert.equal(orders.length,0);
      assert.equal(actions[0].target,partner.email);
      assert.equal(writes.includes('project.project'),false);
      return;
    }
    assert.equal(orders.length,0);
    assert.equal(lead.stage_id,1);
    const partial=await app.processQuoteReply({...parsed,text:'Grazie, confermo Milano.\n\nOn Wed, 21 Oct 2026 06:44:18 +0000, Fancy Truck <hello@fancytruck.it> wrote:\n> Data: 20/12/2026. 80 ospiti, 4 ore, 2 foodtruck. Cena.\n> Personalizzazioni: nessuna. Attrezzature: nessuna. Allestimenti: nessuno. Richieste particolari: nessuna.\n> Staff: nostro. Gestione del servizio: nostra. Permessi: nostri. Adempimenti: nostri.',messageId:`<${item.kind}-partial>`},2,lead);
    assert.equal(partial.lead_id,first.lead_id);
    assert.ok(partial.missing.length>0);
    assert.doesNotMatch(lead.description, /On Wed|> Personalizzazioni/);
    if(item.kind==='rental') for(const field of ['personalizzazioni','attrezzature','allestimenti','richieste particolari']) {
      assert(partial.missing.some(value=>value.includes(field)), `Quoted question must not complete ${field}`);
    }
    if(item.kind==='catering') assert(partial.missing.includes('numero di ospiti'));
    assert.equal(orders.length,0);
    assert.equal(lead.stage_id,1);
    const completedMessage={...parsed,text:item.reply,messageId:`<${item.kind}-reply>`};
    const second=await app.processQuoteReply(completedMessage,3,lead);
    assert.equal(second.lead_id,first.lead_id);assert.equal(second.ready_for_review,true);
    assert.equal(app.store.action(actions[0].id).status,'CANCELLED');
    assert.equal(writes.filter(model=>model==='crm.lead').length,1);
    assert.equal(lead.stage_id,2);
    if(item.kind==='rental') {
      assert.equal(orders.length,1);
      assert.equal(orders[0].pricelist_id,1);
      assert.equal(orders[0].order_line[0][2].display_type,'line_note');
      assert.equal(orders[0].order_line[0][2].price_unit,undefined);
      assert.match(orders[0].order_line[0][2].name,/Airstream Replica 4m/);
    } else {
      assert.equal(orders.length,0);
      assert.equal(writes.includes('project.project'),false);
    }
    const priorWrites=writes.length, priorOrders=orders.length;
    const replay=await app.processQuoteReply(completedMessage,3,lead);
    assert.equal(replay.duplicate,true);
    assert.equal(writes.length,priorWrites);
    assert.equal(orders.length,priorOrders);
    assert.ok(Object.values(app.store.state.actions).filter(action=>action.case_id===`odoo-lead-${lead.id}`)
      .every(action=>['PENDING_APPROVAL','CANCELLED'].includes(action.status)));
  });
  await t.test('draft endpoint applies separate logistics minima and delegates price to Odoo', async()=>{
    orders=[];
    const endpoint=`http://127.0.0.1:${app.server.address().port}/v1/odoo/sales/drafts`;
    const response=await realFetch(endpoint,{method:'POST',headers:{authorization:'Bearer test-only','content-type':'application/json'},
      body:JSON.stringify({partner_id:7,idempotency_key:'logistics-check',order_type:'rental',
        rental_start_date:'2026-12-20 09:00:00',rental_return_date:'2026-12-21 09:00:00',
        lines:[],standard_logistics:{deliveryKm:180,collectionKm:20}})});
    assert.equal(response.status,201);
    assert.equal(orders.length,1);
    assert.equal(orders[0].pricelist_id,1);
    assert.deepEqual(orders[0].order_line.map(line=>line[2].product_uom_qty),[180,100]);
    assert(orders[0].order_line.every(line=>line[2].product_id===7 && !('price_unit' in line[2])));
    const rejected=await realFetch(endpoint,{method:'POST',headers:{authorization:'Bearer test-only','content-type':'application/json'},
      body:JSON.stringify({partner_id:7,idempotency_key:'logistics-without-distances',lines:[{product_id:7,name:'Logistica',quantity:20,price_unit:2}]})});
    assert.equal(rejected.status,502);
    assert.equal(orders.length,1);
  });

});
