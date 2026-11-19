import {hash,problem} from './peuCommon.js';
export const customerTag='Cliente verificato — Peu';
const clean=(s,n)=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const key=a=>(a.date_deadline||'9999-12-31')+':'+String(a.id).padStart(12,'0');
// The tag is assigned after checking the actual customer request, never from a sender alone.
export async function customerActions(read,p={},now=new Date()){
 const leads=await read('crm.lead',[["active","=",true],["tag_ids.name","=",customerTag],["stage_id.name","not in",['Completata','Stand-by']]],{fields:['id','name','active','stage_id','tag_ids'],limit:501,order:'id asc'});
 if(!Array.isArray(leads)||leads.length>500)throw problem('customer_actions_incomplete',503);
 const eligible=leads.filter(l=>l.active!==false&&!/collaudo|self.?test|\btest\b/i.test(l.name)&&!['Completata','Stand-by'].includes(l.stage_id?.[1]));
 const map=new Map(eligible.map(l=>[l.id,l]));
 const rows=eligible.length?await read('mail.activity',[["res_model","=","crm.lead"],["res_id","in",[...map.keys()]]],{fields:['id','res_id','summary','date_deadline','write_date'],limit:1001,order:'date_deadline asc, id asc'}):[];
 if(!Array.isArray(rows)||rows.length>1000)throw problem('customer_actions_incomplete',503);
 const seen=new Set(),all=rows.filter(a=>map.has(a.res_id)&&Number.isInteger(a.id)).sort((a,b)=>key(a).localeCompare(key(b))).filter(a=>{if(seen.has(a.res_id))return false;seen.add(a.res_id);return true;});
 const remaining=all.filter(a=>!p.after||key(a)>p.after),page=remaining.slice(0,p.limit||3);
 return {ok:true,source:'odoo',actions:page.map(a=>({activity_id:a.id,opportunity_id:a.res_id,customer:clean(map.get(a.res_id).name,65),summary:clean(a.summary||'Verificare il prossimo passo con il cliente',125),deadline:a.date_deadline||null,revision:hash({id:a.id,res_id:a.res_id,summary:a.summary,date_deadline:a.date_deadline,write_date:a.write_date})})),total:all.length,next_after:remaining.length>page.length?key(page.at(-1)):null,signature:hash(all.map(a=>({id:a.id,lead:a.res_id,summary:a.summary,deadline:a.date_deadline}))),checked_at:now.toISOString()};
}
