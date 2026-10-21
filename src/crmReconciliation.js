// Only unmistakable non-sales subjects. Uncertain and operational threads stay open.
export function nonCommercialCrmReason(name = '') {
 const title=String(name).trim();
 if (/^(?:re|r|fw|fwd|i)\s*:/i.test(title)) return null;
 if (/^(?:Spedito|Consegnato|In consegna|Ordinato|Ordinati|Articoli annullati):/i.test(title)) return 'notifica_acquisto';
 if (/Scrivi una recensione su Amazon/i.test(title)) return 'notifica_acquisto';
 if (/\bMembership Rewards\b|^Il tuo estratto conto è pronto$|^La\s+tua\s+Carta\s+è\s+stata\s+rimossa\s+da\s+Apple\s+Pay/i.test(title)) return 'notifica_finanziaria';
 if (/^New login to Instagram\b|^Abbiamo rilevato accessi da un nuovo dispositivo alla tua casella$/i.test(title)) return 'notifica_accesso';
 if (/^Aruba\.it\s*[–-]\s*Risoluzione richiesta assistenza nr\./i.test(title)) return 'assistenza_fornitore';
 if (/Riepilogo periodico Odoo personale$|^Fancy Truck close rate$/i.test(title)) return 'riepilogo_automatico';
 if (/^\[Brevo\] Le chiavi SMTP saranno contrassegnate come inattive/i.test(title)) return 'notifica_servizio';
 return null;
}

export async function reconcileCrm({ call, store }) {
 const stages=await call('crm.stage','search_read',[ [['name','=','Nuove richieste']] ],{fields:['name'],limit:2});
 if(stages.length!==1)throw Error('Fase Nuove richieste non univoca');
 const stageId=stages[0].id;
 const report={inspected:0,archived:0,protected:0};
 let last=0;
 for(let page=0;page<20;page++){
  const leads=await call('crm.lead','search_read',[[['active','=',true],['stage_id','=',stageId],['id','>',last]]],
   {fields:['name','active','stage_id','write_date','description','partner_id','email_from'],order:'id asc',limit:100});
  if(!leads.length)break;
  for(const lead of leads){
   last=lead.id;report.inspected++;
   const reason=nonCommercialCrmReason(lead.name);if(!reason)continue;
   // Quotes, including drafts, protect a case from automatic housekeeping.
   const orders=await call('sale.order','search_count',[[['opportunity_id','=',lead.id]]]);
   if(orders){report.protected++;continue;}
   const latest=await call('crm.lead','search_read',[[['id','=',lead.id],['active','=',true],['stage_id','=',stageId],['write_date','=',lead.write_date]]],{fields:['id'],limit:1});
   if(!latest.length){report.protected++;continue;}
   const key=`crm-noncommercial:${lead.id}`;
   store.state.crm_archive_backups??={};
   if(!store.state.crm_archive_backups[lead.id]){
    store.state.crm_archive_backups[lead.id]={at:new Date().toISOString(),reason,lead};store.save();
   }
   await call('crm.lead','write',[[lead.id],{active:false}]);
   const verify=await call('crm.lead','search_read',[[['id','=',lead.id]]],{fields:['active'],context:{active_test:false},limit:1});
   if(verify.length!==1||verify[0].active!==false)throw Error(`Archiviazione CRM ${lead.id} non verificata`);
   const caseId=`odoo-lead-${lead.id}`;
   for(const action of Object.values(store.state.actions)){
    if(action.case_id===caseId&&!['EXECUTED','CANCELLED'].includes(action.status)){
     Object.assign(action,{status:'CANCELLED',cancelled_at:new Date().toISOString(),cancel_reason:'CRM_NON_COMMERCIAL'});
    }
   }
   if(store.state.cases[caseId])Object.assign(store.state.cases[caseId],{crm_archived:true,crm_archive_reason:reason});
   store.audit('CRM_NON_COMMERCIAL_ARCHIVED',{lead_id:lead.id,reason});
   store.remember(key,{archived:true,reason});report.archived++;
  }
  if(leads.length<100)break;
 }
 return report;
}
