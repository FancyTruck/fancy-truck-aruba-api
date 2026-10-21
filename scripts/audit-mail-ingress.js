// Configuration audit only: no passwords, messages, changes or server import.
import fs from 'node:fs';
const report={at:new Date().toISOString(),models:{},errors:[]};
async function read(model,domain,fields,limit=200){
 const response=await fetch(`${process.env.ODOO_URL.replace(/\/$/,'')}/json/2/${model}/search_read`,{
  method:'POST',headers:{authorization:`bearer ${process.env.ODOO_API_KEY}`,'x-odoo-database':process.env.ODOO_DB,'content-type':'application/json'},
  body:JSON.stringify({domain,fields,limit,context:{active_test:false}}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`${model}: HTTP ${response.status}`);
 return response.json();
}
for(const [model,wanted,domain] of [
 ['fetchmail.server',['name','active','state','server_type','server','user','object_id'],[]],
 ['mail.alias',['alias_name','alias_model_id','alias_force_thread_id','alias_parent_model_id','alias_parent_thread_id','alias_contact'],[['alias_model_id.model','in',['crm.lead','sale.order','project.project','project.task']]]],
 ['ir.cron',['name','active','model_id','nextcall'],[['model_id.model','in',['fetchmail.server','crm.lead']]]],
]){
 try{
  const schema=await read('ir.model.fields',[['model','=',model],['name','in',wanted]],['name']);
  const fields=schema.map(f=>f.name);
  if(!fields.length)throw Error(`${model}: schema non accessibile`);
  report.models[model]=await read(model,domain,fields);
 }catch(error){report.errors.push(error.message);}
}
fs.writeFileSync('/var/data/fancy-mail-ingress-audit.json',JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify(report,null,2));
console.log('AUDIT INGRESSO EMAIL: sola lettura; nessuna configurazione modificata, nessuna email inviata.');
if(report.errors.length)process.exitCode=1;
