import {hash,problem} from './peuCommon.js';
import {activityRevision} from './completeCustomerActivity.js';
const tag='Cliente verificato — Peu';
const fields=['id','name','partner_id','stage_id','expected_revenue','date_deadline','description','write_date'];
export async function customerWorkspace(read,write,capability,p){
 const leads=await read('crm.lead',[['id','=',p.opportunity_id],['active','=',true],['tag_ids.name','=',tag]],{fields,limit:2});
 if(leads.length!==1)throw problem('customer_not_verified',409);
 const lead=leads[0],revision=hash(lead);
 if(capability==='crm.customer'){
  const [activities,history]=await Promise.all([read('mail.activity',[['res_model','=','crm.lead'],['res_id','=',lead.id]],{fields:['id','res_id','summary','note','date_deadline','write_date'],limit:101,order:'date_deadline asc,id asc'}),read('mail.message',[['model','=','crm.lead'],['res_id','=',lead.id]],{fields:['id','body','date','author_id','message_type'],limit:20,order:'id desc'})]);
  return {ok:true,lead,revision,activities:activities.slice(0,100).map(a=>({...a,activity_id:a.id,opportunity_id:lead.id,customer:lead.name,revision:activityRevision(a)})),activities_has_more:activities.length>100,history,checked_at:new Date().toISOString()};
 }
 if(p.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date))throw problem('invalid_date');
 if(!write)throw problem('customer_write_unavailable',503);
 if(p.revision!==revision)throw problem('customer_changed_refresh',409);
 if(capability==='crm.change_stage'){
  const stages=await read('crm.stage',[['id','=',p.stage_id]],{fields:['id','name'],limit:2});if(stages.length!==1)throw problem('stage_unavailable',409);
  await write('crm.lead','write',[[lead.id],{stage_id:p.stage_id}]);
  const result=await read('crm.lead',[['id','=',lead.id]],{fields:['stage_id'],limit:1});if(result[0]?.stage_id?.[0]!==p.stage_id)throw problem('stage_update_unverified',502);
  return {ok:true,status:'stage_updated',opportunity_id:lead.id};
 }
 if(capability==='crm.add_activity'){
  const models=await read('ir.model',[['model','=','crm.lead']],{fields:['id'],limit:1}),types=await read('mail.activity.type',[['category','=','default']],{fields:['id'],limit:1});
  if(!models.length||!types.length)throw problem('activity_configuration_unavailable',503);
  const created=await write('mail.activity','create',[[{res_model_id:models[0].id,res_id:lead.id,activity_type_id:types[0].id,summary:p.summary,date_deadline:p.date}]]);
  const id=Array.isArray(created)?created[0]:created;
  const rows=await read('mail.activity',[['id','=',id],['res_model','=','crm.lead'],['res_id','=',lead.id]],{fields:['id'],limit:1});if(rows.length!==1)throw problem('activity_create_unverified',502);
  return {ok:true,status:'activity_created',activity_id:id,opportunity_id:lead.id};
 }
 if(capability==='crm.postpone_activity'){
  const rows=await read('mail.activity',[['id','=',p.activity_id],['res_model','=','crm.lead'],['res_id','=',lead.id]],{fields:['id','res_id','summary','date_deadline','write_date'],limit:1});
  if(!rows.length||activityRevision(rows[0])!==p.activity_revision)throw problem('customer_activity_changed',409);
  await write('mail.activity','write',[[p.activity_id],{date_deadline:p.date}]);
  const after=await read('mail.activity',[['id','=',p.activity_id]],{fields:['date_deadline'],limit:1});if(after[0]?.date_deadline!==p.date)throw problem('activity_update_unverified',502);
  return {ok:true,status:'activity_postponed',activity_id:p.activity_id};
 }
 throw problem('capability_not_supported',400);
}
