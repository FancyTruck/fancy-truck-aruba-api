const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function intakeStatus(state, {now=Date.now(), operating=false}={}) {
  const reviews=Object.values(state.classification_reviews||{}).filter(x=>x.status==='DA_CLASSIFICARE').sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const uncertain=Object.values(state.mail_operations||{}).filter(x=>x.status==='STARTED');
  const cycle=state.cycles?.at(-1);
  const issues=[];
  if(reviews.length) issues.push({code:'REVIEWS_PENDING',count:reviews.length});
  if(uncertain.length) issues.push({code:'UNCERTAIN_WRITES',count:uncertain.length});
  if(cycle?.status==='RUNNING' && now-Date.parse(cycle.started_at)>20*60e3) issues.push({code:'CYCLE_STALLED'});
  else if(cycle && ['INTERRUPTED','CONTROLLO NON COMPLETATO'].includes(cycle.status)) issues.push({code:'CYCLE_FAILED'});
  if(operating && (!cycle || now-Date.parse(cycle.ended_at||cycle.started_at)>90*60e3)) issues.push({code:'POLLING_OVERDUE'});
  const failures=Object.values(state.mail_outcomes||{}).filter(x=>x.status==='RETRY_PENDING');
  if(failures.length) issues.push({code:'MESSAGES_BLOCKED',count:failures.length});
  return {ok:issues.length===0,issues,reviews,uncertain:uncertain.length,failures,last_cycle:cycle||null};
}
export function suspensionDescription(row) {
  const reasons={large_message_requires_review:'Email oltre 10 MB: conservata su Aruba, da esaminare manualmente',reply_without_matching_lead:'Risposta cliente senza pratica collegata',commercial_intent_not_established:'Contenuto da classificare: possibile richiesta cliente',previous_operation_outcome_uncertain:'Esito di una scrittura da verificare prima di riprovare',new_thread_existing_customer:'Nuova conversazione di un cliente esistente: verificare il collegamento'};
  return row.error || reasons[row.reason] || row.reason || 'Verifica manuale richiesta';
}
export async function syncIntakeWatchdog({state,call,login,now=Date.now(),operating=false}) {
  const status=intakeStatus(state,{now,operating});
  const summary='Fancy AI — richieste sospese e controllo lettura';
  const users=await call('res.users','search_read',[[['login','=ilike',login],['active','=',true]]],{fields:['partner_id'],limit:2});
  if(users.length!==1 || !users[0].partner_id?.[0]) throw Error('Responsabile controllo richieste non univoco');
  const user=users[0], partner=user.partner_id[0];
  const activities=await call('mail.activity','search_read',[[['res_model','=','res.partner'],['res_id','=',partner],['user_id','=',user.id],['summary','=',summary]]],{fields:['note'],limit:2});
  if(activities.length>1) throw Error('Attività controllo duplicate: riconciliazione richiesta');
  if(status.ok && !activities.length) return {status:'OK',issues:[]};
  const note=status.ok ? '<p>Controlli rientrati: nessuna sospensione o interruzione rilevata. Questa attività può essere chiusa.</p>' :
    '<p>Richieste da verificare: '+status.reviews.length+'. Scritture con esito incerto: '+status.uncertain+'.</p><p>'+status.issues.map(x=>({REVIEWS_PENDING:'Richieste sospese da esaminare',UNCERTAIN_WRITES:'Operazioni Odoo da verificare prima di riprovare',CYCLE_STALLED:'Lettura in corso da oltre 20 minuti',CYCLE_FAILED:'Ultimo controllo interrotto o incompleto',POLLING_OVERDUE:'Controllo in ritardo di oltre 90 minuti',MESSAGES_BLOCKED:'Messaggi in attesa di recupero'}[x.code])).join('; ')+'</p>'+status.reviews.slice(0,50).map(x=>'<p><b>'+escape(x.subject)+'</b><br>'+escape(x.sender)+' — '+escape(suspensionDescription(x))+'</p>').join('')+(status.reviews.length>50?'<p>Elenco limitato alle prime 50: tutte le richieste restano nel pannello revisioni.</p>':'')+'<p>Aprire Fancy AI / Revisioni per i dettagli. Nessuna autorizzazione a inviare messaggi ai clienti.</p>';
  const context={mail_activity_quick_update:true,tracking_disable:true};
  if(activities.length) {
    if(activities[0].note!==note) await call('mail.activity','write',[[activities[0].id],{note}],{context});
    return {status:status.ok?'OK':'ATTENTION',activity_id:activities[0].id,issues:status.issues};
  }
  const models=await call('ir.model','search_read',[[['model','=','res.partner']]],{fields:['id'],limit:1});
  const types=await call('mail.activity.type','search_read',[[['res_model','in',[false,'res.partner']]]],{fields:['id'],order:'sequence,id',limit:1});
  if(!models.length||!types.length) throw Error('Attività interne non disponibili');
  const ids=await call('mail.activity','create',[[{res_model_id:models[0].id,res_id:partner,user_id:user.id,activity_type_id:types[0].id,summary,note,date_deadline:new Date(now).toISOString().slice(0,10)}]],{context});
  return {status:'ATTENTION',activity_id:Array.isArray(ids)?ids[0]:ids,issues:status.issues};
}
