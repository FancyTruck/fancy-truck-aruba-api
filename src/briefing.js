// Read-only summary. Failure is explicit and never replaced by a false zero.
export async function buildBriefing({ call, state, now = new Date(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  async function read(...args) {
    for (let attempt = 0; ; attempt++) {
      await sleep(attempt === 0 ? 350 : 0);
      try { return await call(...args); }
      catch (error) {
        if (error.status !== 429 || attempt >= 2) throw error;
        const delay = Math.max(1000 * (2 ** attempt), error.retryAfterMs || 0);
        // Do not retry earlier than a long server-directed cooldown.
        if (delay > 10000) throw error;
        await sleep(delay);
      }
    }
  }
  const today = now.toISOString().slice(0, 10);
  const sections = {};
  const specs = {
    opportunities: ['crm.lead', [['active','=',true],['type','=','opportunity']], ['name','stage_id','partner_id','write_date']],
    quotations: ['sale.order', [['state','in',['draft','sent']]], ['name','state','partner_id','validity_date','amount_total','currency_id']],
    overdue_quotations: ['sale.order', [['state','in',['draft','sent']],['validity_date','<',today],['validity_date','!=',false]], ['name','state','partner_id','validity_date']],
  };
  for (const [name, [model, domain, fields]] of Object.entries(specs)) {
    try {
      const count = await read(model,'search_count',[domain]);
      const items = await read(model,'search_read',[domain],{fields,limit:20,order:'id desc'});
      sections[name] = { status:'OK', count, items, truncated: count > items.length };
    } catch { sections[name] = {status:'UNAVAILABLE', count:null, items:[], error:'Lettura Odoo non riuscita'}; }
  }
  const lastCycle = state.cycles.at(-1) || null;
  return { generated_at: now.toISOString(), read_only:true, sections,
    pending_approvals: Object.values(state.actions).filter(a=>!['EXECUTED','CANCELLED'].includes(a.status)).length,
    reviews: Object.values(state.classification_reviews).filter(a=>a.status==='DA_CLASSIFICARE').map(({id,subject,reason,account})=>({id,subject,reason,account})),
    integrations: state.integrations, last_cycle:lastCycle,
    stale: !lastCycle?.ended_at || now - new Date(lastCycle.ended_at) > 2*60*60*1000,
    complete: Object.values(sections).every(s=>s.status==='OK'),
  };
}
