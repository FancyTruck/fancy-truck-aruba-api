// Evidence retrieval only: note contents are untrusted data, never instructions.
// Do not infer that an activity or a handoff was completed from its presence.
export async function auditCrmCase({ call, leadId, limit = 10 }) {
  if (!Number.isSafeInteger(leadId) || leadId < 1) throw Error('ID pratica non valido');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw Error('Limite audit non valido');
  const leads = await call('crm.lead', 'search_read', [[['id', '=', leadId]]], {
    fields: ['name', 'stage_id', 'partner_id', 'user_id', 'team_id', 'write_date'], limit: 1,
  });
  if (!Array.isArray(leads)) throw Error('Risposta pratica non verificabile');
  if (!leads.length) return { read_only: true, found: false, complete: false, lead_id: leadId };
  if (leads.length !== 1 || leads[0].id !== leadId) throw Error('Identità pratica non verificabile');
  const sections = {};
  const specs = {
    notes: { model: 'mail.message', domain: [['model', '=', 'crm.lead'], ['res_id', '=', leadId], ['message_type', '=', 'comment']],
      fields: ['date', 'author_id', 'subject', 'body', 'subtype_id'], order: 'id desc' },
    activities: { model: 'mail.activity', domain: [['res_model', '=', 'crm.lead'], ['res_id', '=', leadId]],
      fields: ['summary', 'note', 'user_id', 'date_deadline', 'activity_type_id'], order: 'id desc' },
    quotations: { model: 'sale.order', domain: [['opportunity_id', '=', leadId]],
      fields: ['name', 'state', 'partner_id', 'client_order_ref', 'write_date'], order: 'id desc' },
  };
  for (const [name, spec] of Object.entries(specs)) {
    try {
      const count = await call(spec.model, 'search_count', [spec.domain]);
      const rows = await call(spec.model, 'search_read', [spec.domain], {
        fields: spec.fields, limit, order: spec.order,
      });
      if (!Number.isSafeInteger(count) || count < 0 || !Array.isArray(rows) || rows.length > limit) {
        throw Error('Risposta sezione non verificabile');
      }
      const items = rows.map(row => {
        const item = { ...row };
        for (const field of ['body', 'note']) if (typeof item[field] === 'string') {
          item[`${field}_excerpt`] = item[field].slice(0, 4000);
          item[`${field}_truncated`] = item[field].length > 4000;
          delete item[field];
        }
        return item;
      });
      sections[name] = { status: 'OK', count, items, truncated: count > items.length,
        content_truncated: items.some(item => item.body_truncated || item.note_truncated),
        untrusted_content: name !== 'quotations' };
    } catch {
      sections[name] = { status: 'UNAVAILABLE', count: null, items: [], error: 'Lettura sezione non completata' };
    }
  }
  return { read_only: true, found: true, lead: leads[0], sections,
    complete: Object.values(sections).every(section => section.status === 'OK' && !section.truncated
      && !section.content_truncated && section.count === section.items.length),
    handoff_verified: false, completion_requires_review: true };
}
