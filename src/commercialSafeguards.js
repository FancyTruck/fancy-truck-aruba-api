// Verified company and pricelist IDs from the user's Odoo database.
export function quotationPricelist(partner) {
  const current = Array.isArray(partner.property_product_pricelist)
    ? partner.property_product_pricelist[0] : partner.property_product_pricelist;
  const authorized = partner.id === 10 && partner.company_type === 'company'
    && String(partner.vat || '').replace(/\s/g, '').toUpperCase() === 'IT02119200992';
  if (authorized) return 13;
  if (current === 13) throw new Error('Listino G.d.C. riservato a Il Gelato della Carla SAS: verificare l’anagrafica');
  if (!Number.isSafeInteger(current) || current <= 0) throw new Error('Listino cliente non verificato');
  return current;
}
export function procedureStage(stages, status) {
  const labels = status === 'DA_INTEGRARE' ? ['Da integrare', 'Nuove richieste'] : ['Qualificate'];
  for (const label of labels) {
    const matches = stages.filter(stage => String(stage.name).trim().toLowerCase() === label.toLowerCase());
    if (matches.length > 1) throw new Error(`Fase CRM ambigua: ${label}`);
    if (matches.length === 1) return matches[0];
  }
  throw new Error(`Fase CRM mancante: ${labels.join(' / ')}`);
}
