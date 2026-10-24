// An opportunity can contain several legitimate quotes. Only an exact source
// marker within the same customer/opportunity establishes a replay here.
export function quotationDisposition(orders, { leadId, partnerId, key, complete = true }) {
  const id = value => Array.isArray(value) ? value[0] : value;
  const exact = orders.filter(order => order.client_order_ref === `AUTO:${key}`
    && id(order.opportunity_id) === leadId && id(order.partner_id) === partnerId);
  if (complete && exact.length === 1 && exact[0].state !== 'cancel') {
    return { kind: 'replay', order: exact[0] };
  }
  if (!complete || orders.length) {
    return { kind: 'review', reason: 'quotation_scope_requires_review',
      order_ids: orders.map(order => order.id) };
  }
  return { kind: 'new' };
}
