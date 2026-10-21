// Read-only summary. Failure is explicit and never replaced by a false zero.
export async function buildBriefing({ call, state, now = new Date() }) {
  const today = now.toISOString().slice(0, 10);
  const sections = {};
  const specs = {
    opportunities: ['crm.lead', [['active','=',true],['type','=','opportunity']], ['name','stage_id','partner_id','write_date']],
    quotations: ['sale.order', [['state','in',['draft','sent']]], ['name','state','partner_id','validity_date','amount_total','currency_id']],
    overdue_quotations: ['sale.order', [['state','in',['draft','sent']],['validity_date','<',today],['validity_date','!=',false]], ['name','state','partner_id','validity_date']],
  };
  await Promise.all(Object.entries(specs).map(async ([name, [model, domain, fields]]) => {
    try {
      const [count, items] = await Promise.all([
        call(model,'search_count',[domain]),
        call(model,'search_read',[domain],{fields,limit:20,order:'id desc'}),
      ]);
      sections[name] = { status:'OK', count, items, truncated: count > items.length };
    } catch { sections[name] = {status:'UNAVAILABLE', count:null, items:[], error:'Lettura Odoo non riuscita'}; }
  }));
  const lastCycle = state.cycles.at(-1) || null;
  return { generated_at: now.toISOString(), read_only:true, sections,
    pending_approvals: Object.values(state.actions).filter(a=>!['EXECUTED','CANCELLED'].includes(a.status)).length,
    reviews: Object.values(state.classification_reviews).filter(a=>a.status==='DA_CLASSIFICARE').map(({id,subject,reason,account})=>({id,subject,reason,account})),
    integrations: state.integrations, last_cycle:lastCycle,
    stale: !lastCycle?.ended_at || now - new Date(lastCycle.ended_at) > 2*60*60*1000,
    complete: Object.values(sections).every(s=>s.status==='OK'),
  };
}
