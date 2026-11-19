// Reserve the durable action before SMTP yields. Uncertain sends are never
// returned to an executable state, including after a process restart.
export async function executeMailAction({approvals,id,send}) {
  const action=approvals.assertExecutable(id);
  if(action.peu_payload_hash)throw Error('Usare il comando Peu dedicato con registro persistente');
  if(!['SEND_EMAIL','SEND_FOLLOW_UP','SEND_PAYMENT_REMINDER','SEND_QUOTE','SEND_CONTRACT','SEND_INVOICE'].includes(action.type))throw Error('Questa azione richiede un connettore specifico e non può essere eseguita via SMTP generico');
  const payload=action.payload||{};
  if((!payload.to&&!action.target)||!payload.subject||(!payload.text&&!payload.html))throw Error('Contenuto non completo: esecuzione bloccata');
  const execution=approvals.store.beginSmtpExecution(id);
  let observation;
  try {
    const info=await send({...payload,to:payload.to||action.target,messageId:execution.message_id});
    observation={message_id:info.messageId||execution.message_id,
      accepted:Array.isArray(info.accepted)?info.accepted:[],
      rejected:Array.isArray(info.rejected)?info.rejected:[],
      pending:Array.isArray(info.pending)?info.pending:[]};
    if(!Array.isArray(info.accepted)||!info.accepted.length||info.rejected?.length||info.pending?.length)throw Error('Esito SMTP non verificato');
    return approvals.store.finishSmtpExecution(id,execution.id,'EXECUTED',{
      status:'accepted_by_smtp',delivery_verified:false,
      message_id:info.messageId||execution.message_id,accepted:info.accepted,rejected:info.rejected||[]});
  } catch(error) {
    try { approvals.store.finishSmtpExecution(id,execution.id,'UNCERTAIN',{
      status:'outcome_unknown_reconcile_first',delivery_verified:false,
      ...(observation?{provider_observation:observation}:{})}); } catch { /* Durable EXECUTING claim still blocks replay. */ }
    throw Object.assign(error,{code:'SMTP_OUTCOME_UNCERTAIN'});
  }
}
