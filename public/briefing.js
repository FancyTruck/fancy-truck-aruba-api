let token='';const byId=id=>document.getElementById(id);
function node(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
async function refresh(){
 byId('status').textContent='Verifica in corso…';byId('content').replaceChildren();
 try {
  const response=await fetch('/v1/briefing',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!response.ok)throw Error(response.status===401?'Chiave non valida o revocata':'Briefing non disponibile');
  const data=await response.json();
  byId('status').textContent=`Aggiornato ${new Date(data.generated_at).toLocaleString('it-IT')}. ${data.complete?'Letture Odoo completate.':'Alcune letture non sono disponibili.'} ${data.stale?'Ultimo ciclo assente o risalente a oltre due ore.':''}`;
  const out=byId('content');out.append(node('h2','Da controllare'),node('p',`${data.pending_approvals} azioni in attesa · ${data.reviews.length} casi da classificare`));
  for(const [key,label] of [['opportunities','Opportunità aperte'],['quotations','Preventivi in bozza o inviati'],['overdue_quotations','Preventivi scaduti']]){
   const section=data.sections[key];out.append(node('h2',label));
   if(section.status!=='OK'){out.append(node('p','Controllo non completato: nessun conteggio affidabile.'));continue;}
   out.append(node('p',`${section.count} in totale${section.truncated?' · mostrate le ultime 20':''}`));
   const list=node('ul','');for(const item of section.items){const details=[item.name,item.partner_id?.[1],item.stage_id?.[1],item.validity_date&&`Scadenza ${item.validity_date}`].filter(Boolean);list.append(node('li',details.join(' · ')));}out.append(list);
  }
  out.append(node('h2','Casi da classificare'));for(const item of data.reviews)out.append(node('p',`${item.subject||'Senza oggetto'} · ${item.reason}`));
  out.append(node('h2','Connessioni e backup'));for(const [name,item] of Object.entries(data.integrations))out.append(node('p',`${name}: ${item.status||'da verificare'}`));
  byId('login').hidden=true;byId('refresh').hidden=false;byId('logout').hidden=false;
 }catch(e){byId('status').textContent=e.message;}
}
byId('login').addEventListener('submit',e=>{e.preventDefault();token=byId('key').value;byId('key').value='';refresh();});
byId('refresh').addEventListener('click',refresh);
byId('logout').addEventListener('click',()=>{token='';byId('content').replaceChildren();byId('status').textContent='Sessione chiusa';byId('login').hidden=false;byId('refresh').hidden=true;byId('logout').hidden=true;});
