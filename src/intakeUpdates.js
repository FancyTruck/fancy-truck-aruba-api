import {hash,problem} from './peuCommon.js';
import {intakeStatus} from './intakeWatchdog.js';
// Owner notifications consume operational evidence, never issue CRM or mail writes.
export function intakeUpdates(state,{since,after='',limit=100},now=Date.now()){
 const start=Date.parse(since);
 if(typeof since!=='string'||!Number.isFinite(start)||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof after!=='string'||after.length>150)throw problem('invalid_update_cursor');
 const events=[];
 for(const [key,row] of Object.entries(state.mail_outcomes||{})){
  const at=Date.parse(row.at);
  if(!['hello','pietro'].includes(row.account)||!Number.isFinite(at)||at<start||at>now||row.duplicate||row.skipped||row.status!=='ODOO_LINKED')continue;
  events.push({id:hash('mail:'+key),at:row.at,type:row.reply||row.linked?'customer_reply':'commercial_request',account:row.account,uid:row.uid,lead_id:row.lead_id||null,subject:row.subject||'',sender:row.sender||'',excerpt:row.excerpt||'',message_id:row.message_id||null});
 }
 for(const row of Object.values(state.classification_reviews||{})){
  const at=Date.parse(row.created_at);
  if((row.snoozed_until&&Date.parse(row.snoozed_until)>now)||row.status!=='DA_CLASSIFICARE'||row.mailbox!=='INBOX'||!['hello','pietro'].includes(row.account)||!Number.isFinite(at)||at<start||at>now)continue;
  events.push({id:hash('review:'+row.id),at:row.created_at,type:'customer_review',account:row.account,subject:String(row.subject||'').slice(0,200),review_id:row.id,reason:row.reason});
 }
 const cursor=e=>e.at+'|'+e.id;
 events.sort((a,b)=>cursor(a).localeCompare(cursor(b)));
 const candidates=events.filter(e=>cursor(e)>after),page=candidates.slice(0,limit);
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
 const health=intakeStatus(state,{now,operating:hour>=8&&hour<20}).issues;
 for(const [name,row] of Object.entries(state.integrations||{}))if(['ERROR','UNAVAILABLE','CONTROLLO NON COMPLETATO'].includes(row.status))health.push({code:'INTEGRATION_UNAVAILABLE',integration:name});
 return {ok:true,events:page,next_after:candidates.length>limit?cursor(page.at(-1)):null,checked_at:new Date(now).toISOString(),health};
}

