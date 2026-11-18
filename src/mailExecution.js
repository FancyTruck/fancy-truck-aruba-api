// Reserve the durable action before SMTP yields. Uncertain sends are never
// returned to an executable state, including after a process restart.
export async function executeMailAction({approvals,id,send}) {
  const action=approvals.assertExecutable(id);
  if(action.peu_payload_hash)throw Error('Usare il comando Peu dedicato con registro persistente');
  if(!['SEND_EMAIL','SEND_FOLLOW_UP','SEND_PAYMENT_REMINDER','SEND_QUOTE','SEND_CONTRACT','SEND_INVOICE'].includes(action.type))throw Error('Questa azione richiede un connettore specifico e non può essere eseguita via SMTP generico');
  const payload=action.payload||{};
  if((!payload.to&&!action.target)||!payload.subject||(!payload.text&&!payload.html))throw Error('Contenuto non completo: esecuzione bloccata');
  const previous={...action};
  try { approvals.store.updateAction(id,{status:'EXECUTING',execution_started_at:new Date().toISOString()}); }
  catch(error) { Object.assign(action,previous);delete action.execution_started_at;throw error; }
  try {
    const info=await send({...payload,to:payload.to||action.target,messageId:`<fancy-${action.id}@fancytruck.it>`});
    if(!info.accepted?.length||info.rejected?.length)throw Error('Esito SMTP non verificato');
    const result={message_id:info.messageId,accepted:info.accepted,rejected:info.rejected||[]};
    approvals.store.updateAction(id,{status:'EXECUTED',executed_at:new Date().toISOString(),result});
  } catch(error) {
    // Keep the in-memory guard even if persisting the uncertain outcome fails.
    action.status='OUTCOME_UNKNOWN';
    try { approvals.store.updateAction(id,{status:'OUTCOME_UNKNOWN',execution_error:'Verificare la posta inviata prima di riconciliare questa azione'}); } catch {}
    throw error;
  }
  approvals.store.audit('ACTION_EXECUTED',{action_id:id,action_type:action.type,target:action.target});
  return action;
}
