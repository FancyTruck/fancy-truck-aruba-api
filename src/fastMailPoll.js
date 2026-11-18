// One shared lock with the hourly full cycle: never process an inbox twice at once.
export function fastMailPoll({canRun,busy,setBusy,poll,record,log=console.log}){return async()=>{
 if(!canRun()||busy())return {status:'skipped'};setBusy(true);const start=Date.now(),checks=[];
 try{for(const account of ['hello','pietro'])try{const result=await poll(account);const retry=result.rows.filter(row=>row.retry_pending),suspended=result.rows.filter(row=>row.suspended);checks.push({account,status:retry.length?'failed':suspended.length?'suspended':'ok',messages:result.rows.length,retry_pending:retry.length});record(account,{status:retry.length?'CONTROLLO NON COMPLETATO':suspended.length?'OK_WITH_SUSPENSIONS':'OK',...(!retry.length?{last_success_at:new Date().toISOString()}:{}),error:retry.length?'Elaborazione in attesa di recupero':null});}catch(error){checks.push({account,status:'failed'});record(account,{status:'CONTROLLO NON COMPLETATO',error:error.message});}
 log(JSON.stringify({event:'mail_intake_check',elapsed_ms:Date.now()-start,checks}));return {status:checks.some(x=>x.status==='failed')?'partial':'ok',checks};
 }finally{setBusy(false);}
};}
