// Render is a read-only project consumer. Creating from two independent
// services is unsafe until they share an authoritative atomic reservation.
const RELATIONS = { sale_order_id: 'sale.order', reinvoiced_sale_order_id: 'sale.order', sale_line_id: 'sale.order.line' };
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const relationId = value => value === false || value === null ? null
  : positiveId(value) ? value : Array.isArray(value) && value.length === 2 && positiveId(value[0]) ? value[0] : undefined;
const review = reason => ({ status: 'REVIEW_REQUIRED', reason, id: null, tasks_verified: false, read_only: true });

export async function resolveProjectAssociation({ call, leadId, orderId, partnerId, projectName }) {
  if (![leadId, orderId, partnerId].every(positiveId)) return review('invalid_project_identity');
  try {
    // Never trust a cached order or infer its customer from the input partner.
    const orders = await call('sale.order', 'search_read', [[['id', '=', orderId]]], {
      fields: ['name', 'state', 'partner_id', 'opportunity_id'], limit: 2,
    });
    if (orders.length !== 1 || orders[0].id !== orderId
      || relationId(orders[0].partner_id) !== partnerId || relationId(orders[0].opportunity_id) !== leadId
      || !['draft', 'sent', 'sale', 'done'].includes(orders[0].state)) return review('project_order_identity_unverified');
    const schema = await call('ir.model.fields', 'search_read', [[
      ['model', '=', 'project.project'], ['name', 'in', ['partner_id', ...Object.keys(RELATIONS)]],
    ]], { fields: ['name', 'ttype', 'relation'], limit: 10 });
    const fields = new Map(schema.map(field => [field.name, field]));
    if (fields.get('partner_id')?.ttype !== 'many2one' || fields.get('partner_id')?.relation !== 'res.partner') {
      return review('project_schema_unverified');
    }
    const relations = Object.entries(RELATIONS).filter(([field]) => fields.has(field));
    if (!relations.length || relations.some(([field, model]) => fields.get(field).ttype !== 'many2one'
      || fields.get(field).relation !== model)) return review('project_schema_unverified');
    const clauses = relations.map(([field]) => [field === 'sale_line_id' ? 'sale_line_id.order_id' : field, '=', orderId]);
    if (projectName) clauses.push(['name', '=', projectName]);
    const projects = await call('project.project', 'search_read', [[
      ...Array(clauses.length - 1).fill('|'), ...clauses,
    ]], { fields: ['name', 'active', 'partner_id', ...relations.map(([field]) => field)],
      limit: 2, context: { active_test: false } });
    // Two rows are already ambiguous; this bounded read need not enumerate them.
    if (projects.length > 1) return review('project_candidates_ambiguous');
    if (!projects.length) return orders[0].state === 'sale' || orders[0].state === 'done'
      ? review('project_single_writer_not_established')
      : { ...review('project_order_not_confirmed'), status: 'DEFERRED' };
    const project = projects[0];
    if (!positiveId(project.id) || project.active !== true || relationId(project.partner_id) !== partnerId) {
      return review('project_customer_or_active_state_unverified');
    }
    const evidence = [];
    for (const [field] of relations) {
      const id = relationId(project[field]);
      if (id === undefined) return review('project_relation_unverified');
      if (id === null) continue;
      if (field === 'sale_line_id') {
        const lines = await call('sale.order.line', 'search_read', [[['id', '=', id]]], { fields: ['order_id'], limit: 2 });
        if (lines.length !== 1 || lines[0].id !== id || relationId(lines[0].order_id) !== orderId) {
          return review('project_sales_line_order_unverified');
        }
      } else if (id !== orderId) return review('project_relations_conflict');
      evidence.push(field);
    }
    if (!evidence.length) return review('project_name_is_not_a_relation');
    return { status: 'REUSED', id: project.id, name: project.name, relations: evidence,
      tasks_verified: false, read_only: true };
  } catch {
    // Access failures and incomplete reads are never treated as an empty result.
    return review('project_association_read_unavailable');
  }
}
