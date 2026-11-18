import {hash,problem} from './peuCommon.js';

// This bridge is for the existing, trusted single-owner Peu connection only.
// A caller cannot choose an actor or substitute an Odoo user identity.
export function makePeuReviews(store,assertWritable,readOriginal) {
  const find=id=>{
    const row=store.state.classification_reviews[id];
    if(!row)throw problem('review_not_found',404);
    return row;
  };
  const view=row=>({
    id:row.id,status:row.status,subject:row.subject||'',sender:row.sender||'',
    account:row.account||'',reason:row.reason||'',created_at:row.created_at||null,
    excerpt:row.excerpt||'',snapshot_hash:hash(row),
    allowed_resolutions:row.status==='DA_CLASSIFICARE'&&!row.operation_id?['NOT_COMMERCIAL','HANDLED_MANUALLY']:[],
    requires_manual_reconciliation:Boolean(row.operation_id),
    resolution:row.resolution||null,resolved_at:row.resolved_at||null,snoozed_until:row.snoozed_until||null,message_id:row.message_id||null,
  });
  return {
    async open_message({account,message_id}){
      assertWritable();if(!['hello','pietro'].includes(account)||!message_id||/[\r\n]/.test(message_id))throw problem('invalid_original_reference');
      const existing=Object.values(store.state.classification_reviews).find(row=>row.account===account&&row.message_id===message_id&&row.mailbox==='INBOX');
      if(existing)return {ok:true,status:'opened',item:(await this.get({review_id:existing.id})).item};
      const response=await readOriginal?.(account,message_id),original=response?.original;
      if(original?.message_id!==message_id||original.folder!=='INBOX'||!original.payload?.text)throw problem('original_unavailable',409);
      const source=original.payload,from=source.from||[];if(from.length!==1||!from[0].address)throw problem('original_sender_ambiguous',409);
      const {item}=store.queueClassification({source_key:JSON.stringify([account,'INBOX',message_id]),account,mailbox:'INBOX',message_id,sender:from[0].address,subject:source.subject||'',excerpt:source.text.slice(0,4000),reason:'owner_followup',candidate_ids:[]});
      return {ok:true,status:'opened',item:{...view(item),original:source,original_status:'verified'}};
    },
    list({limit=50,after_id}={}) {
      const pending=Object.values(store.state.classification_reviews)
        .filter(row=>row.status==='DA_CLASSIFICARE'&&(!row.snoozed_until||Date.parse(row.snoozed_until)<=Date.now())).sort((a,b)=>a.id.localeCompare(b.id));
      const candidates=pending.filter(row=>!after_id||row.id>after_id);
      const page=candidates.slice(0,limit);
      return {ok:true,total:pending.length,items:page.map(view),next_after_id:candidates.length>limit?page.at(-1).id:null};
    },
    async get({review_id}) {
      const row=find(review_id),item=view(row);item.original_status='unavailable';
      if(readOriginal&&row.message_id&&['hello','pietro'].includes(row.account))try{
        const {original}=await readOriginal(row.account,row.message_id);
        if(original?.message_id===row.message_id&&original.folder==='INBOX'&&original.payload?.text){
          item.original={...original.payload,message_id:row.message_id};item.original_status='verified';
        }
      }catch{/* Keep the excerpt visible while exact original recovery is unavailable. */}
      return {ok:true,item};
    },
    snooze({review_id,snapshot_hash,until}){
      assertWritable();const row=find(review_id),date=Date.parse(until);
      if(row.status!=='DA_CLASSIFICARE')throw problem('review_already_closed',409);
      if(hash(row)!==snapshot_hash)throw problem('review_changed_reconfirm',409);
      if(!Number.isFinite(date)||date<=Date.now()||date>Date.now()+366*86400000)throw problem('invalid_review_reminder');
      const item={...row,snoozed_until:new Date(date).toISOString()};
      store.state.classification_reviews[review_id]=item;
      try{store.save();}catch{store.state.classification_reviews[review_id]=row;throw problem('review_persistence_failed',503);}
      store.audit('CLASSIFICATION_SNOOZED',{review_id,until:item.snoozed_until,actor:'peu_owner'});
      return {ok:true,status:'snoozed',item:view(item)};
    },
    resolve({review_id,snapshot_hash,resolution,note}) {
      assertWritable();
      const row=find(review_id);
      if(row.status!=='DA_CLASSIFICARE')throw problem('review_already_closed',409);
      if(hash(row)!==snapshot_hash)throw problem('review_changed_reconfirm',409);
      // An interrupted Odoo write must not be reconciled by a generic voice dismissal.
      if(row.operation_id)throw problem('manual_reconciliation_required',409);
      if(!['NOT_COMMERCIAL','HANDLED_MANUALLY'].includes(resolution)||typeof note!=='string'||note.trim().length<10||note.length>2000)throw problem('invalid_review_resolution');
      try {
        const item=store.resolveClassification(review_id,resolution,note,'peu_owner');
        return {ok:true,status:'resolved',item:view(item),emails_sent:0,odoo_writes:0};
      } catch {throw problem('review_persistence_failed',503);}
    },
  };
}
