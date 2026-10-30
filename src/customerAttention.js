// Internal Odoo activity only: no customer recipients, emails, or quotation sends.
export async function ensureCustomerAttention({ call, leadId, ownerId }) {
  const summary = 'Richiesta cliente da esaminare — Fancy AI';
  const existing = await call('mail.activity', 'search_count', [[
    ['res_model', '=', 'crm.lead'], ['res_id', '=', leadId], ['summary', '=', summary],
  ]]);
  if (existing) return { existing: true };
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw Error('Responsabile richiesta non configurato');
  const models = await call('ir.model', 'search_read', [[['model', '=', 'crm.lead']]], { fields: ['model'], limit: 1 });
  const types = await call('mail.activity.type', 'search_read', [[['res_model', 'in', [false, 'crm.lead']]]], { fields: ['name'], order: 'sequence asc, id asc', limit: 1 });
  if (!models.length || !types.length) throw Error('Tipo attività CRM non disponibile');
  const ids = await call('mail.activity', 'create', [[{
    res_model_id: models[0].id, res_id: leadId, activity_type_id: types[0].id,
    user_id: ownerId, summary, date_deadline: new Date().toISOString().slice(0, 10),
    note: 'Nuova richiesta o risposta cliente acquisita. Verificare il briefing e le eventuali bozze. Nessun invio automatico autorizzato.',
  }]], { context: { mail_activity_quick_update: true } });
  return { created: true, ids };
}
