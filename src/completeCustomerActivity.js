import {hash,problem} from './peuCommon.js';
import {customerTag} from './customerActions.js';
export const activityRevision=a=>hash({id:a.id,res_id:a.res_id,summary:a.summary,date_deadline:a.date_deadline,write_date:a.write_date});
export async function completeCustomerActivity(read,write,p){
 if(!write)throw problem('activity_completion_unavailable',503);
 const leads=await read('crm.lead',[['id','=',p.opportunity_id],['active','=',true],['tag_ids.name','=',customerTag]],{fields:['id'],limit:2});
 if(leads.length!==1)throw problem('customer_activity_not_eligible',409);
 const rows=await read('mail.activity',[['id','=',p.activity_id],['res_model','=','crm.lead'],['res_id','=',p.opportunity_id]],{fields:['id','res_id','summary','date_deadline','write_date'],limit:2});
 if(rows.length!==1||activityRevision(rows[0])!==p.revision)throw problem('customer_activity_changed',409);
 await write(p.activity_id);
 const remaining=await read('mail.activity',[['id','=',p.activity_id]],{fields:['id'],limit:1});
 if(remaining.length)throw problem('activity_completion_unverified',502);
 return {ok:true,status:'completed',activity_id:p.activity_id,opportunity_id:p.opportunity_id};
}
