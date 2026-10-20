// User rule: an option is a sent, unexpired and explicitly unsigned quote.
// Missing signature/expiry evidence is not silently treated as availability.
export function classifyRentalBookings(bookings, { complete = true, now = new Date() } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const definitive = [], options = [], unknown = [], ignored = [];
  for (const row of bookings) {
    if (['sale', 'done'].includes(row.state)) { definitive.push(row); continue; }
    if (row.state === 'cancel') { ignored.push(row); continue; }
    const signed = typeof row.signed_on === 'string' && row.signed_on.trim().length > 0;
    if (signed) { unknown.push(row); continue; } // Signed but not confirmed: reconcile first.
    if (row.state === 'draft') { ignored.push(row); continue; }
    if (row.state !== 'sent') { unknown.push(row); continue; }
    const expiry = row.validity_date;
    const validDate = typeof expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiry)
      && Number.isFinite(Date.parse(expiry)) && new Date(expiry).toISOString().slice(0,10) === expiry;
    if (!validDate || row.signed_on !== false) { unknown.push(row); continue; }
    if (expiry < today) ignored.push(row);
    else options.push(row); // Valid through the expiry date in Europe/Rome.
  }
  return {
    checked: complete && !unknown.length,
    status: definitive.length ? 'UNAVAILABLE' : !complete || unknown.length ? 'UNKNOWN' : options.length ? 'OPTIONED' : 'NO_CONFIRMED_BOOKING',
    definitive, options, unknown, ignored, conflicts: definitive,
  };
}
export function unavailableVehicleAction({ leadId, recipient, product, dates }) {
  return {
    type: 'SEND_EMAIL', target: recipient, case_id: `odoo-lead-${leadId}`,
    idempotency_key: `unavailable:${leadId}:${product.id}:${dates.start}:${dates.end}`,
    payload: { account: 'hello', subject: 'Scelta alternativa per il suo noleggio Fancy Truck',
      text: `Buongiorno, il veicolo richiesto (${product.name}) risulta già impegnato per il periodo richiesto. Può indicarci un modello alternativo dal catalogo https://www.fancytruck.agency/truck/ oppure le caratteristiche essenziali per aiutarla a scegliere? Verificheremo la disponibilità dell’alternativa nelle sue date prima di confermarla.\n\nGrazie,\nFancy AI · Fancy Truck` },
  };
}
