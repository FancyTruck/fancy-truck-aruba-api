import crypto from 'node:crypto';
import {customerTag} from './customerActions.js';
import {classifyCommercialMessage} from './commercialFilter.js';
export async function verifiedCustomerTagId(call){
 const tags=await call('crm.tag','search_read',[[['name','=',customerTag]]],{fields:['id','name'],limit:2});
 if(tags.length>1)throw Error('customer_tag_ambiguous');if(tags.length===1)return tags[0].id;
 const created=await call('crm.tag','create',[[{name:customerTag}]]);return Array.isArray(created)?created[0]:created;
}
// Recover only first-party intake outcomes whose original request still matches
// the exact source marker and sender on the same active Odoo opportunity.
export async function repairCustomerVisibility({call,state,now=new Date()}){
 let enrolled=0,checked=0;const seen=new Set();
 for(const row of Object.values(state.mail_outcomes||{}).sort((a,b)=>String(b.at).localeCompare(String(a.at)))){
  if(checked>=100)break;
  if(row.status!=='ODOO_LINKED'||row.reply||row.linked||row.skipped||row.suspended||!['hello','pietro'].includes(row.account)||!Number.isSafeInteger(row.lead_id)||!row.message_id||!row.sender||seen.has(row.lead_id)||!Number.isFinite(Date.parse(row.at))||Date.parse(row.at)<+now-30*86400000||Date.parse(row.at)>+now)continue;
  const decision=classifyCommercialMessage(row.subject,row.excerpt);if(!decision.kind||decision.kind!==row.kind)continue;
  const completed=Object.values(state.mail_operations||{}).some(op=>op.status==='COMPLETED'&&op.result?.lead_id===row.lead_id&&!op.result.reply&&!op.result.linked&&op.result.kind===row.kind);
  if(!completed)continue;seen.add(row.lead_id);checked++;
  const marker='[AUTO:mail-'+crypto.createHash('sha256').update(row.message_id).digest('hex').slice(0,24)+']';
  const leads=await call('crm.lead','search_read',[[['id','=',row.lead_id],['active','=',true]]],{fields:['id','description','email_from','tag_ids'],limit:2});
  if(leads.length!==1||String(leads[0].email_from||'').trim().toLowerCase()!==row.sender.toLowerCase()||!String(leads[0].description||'').includes(marker))continue;
  const tag=await verifiedCustomerTagId(call);if(leads[0].tag_ids?.includes(tag))continue;
  await call('crm.lead','write',[[row.lead_id],{tag_ids:[[4,tag]]}]);
  const after=await call('crm.lead','search_read',[[['id','=',row.lead_id],['tag_ids','in',[tag]]]],{fields:['id'],limit:1});
  if(after.length!==1)throw Error('customer_enrollment_unverified');enrolled++;
 }
 return {checked,enrolled};
}
