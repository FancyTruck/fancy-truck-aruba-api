import {hash,problem} from './peuCommon.js';

// This bridge is for the existing, trusted single-owner Peu connection only.
// A caller cannot choose an actor or substitute an Odoo user identity.
export function makePeuReviews(store,assertWritable) {
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
    resolution:row.resolution||null,resolved_at:row.resolved_at||null,
  });
  return {
    list({limit=50,after_id}={}) {
      const pending=Object.values(store.state.classification_reviews)
        .filter(row=>row.status==='DA_CLASSIFICARE').sort((a,b)=>a.id.localeCompare(b.id));
      const candidates=pending.filter(row=>!after_id||row.id>after_id);
      const page=candidates.slice(0,limit);
      return {ok:true,total:pending.length,items:page.map(view),next_after_id:candidates.length>limit?page.at(-1).id:null};
    },
    get({review_id}) {return {ok:true,item:view(find(review_id))};},
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
