export const COMMERCIAL_PROCEDURE_VERSION = '2026-08-31';

export const PIETRO_FINAL_CHECKS = Object.freeze([
  'destinatario e contenuto di ogni comunicazione esterna',
  'cliente e anagrafica collegata',
  'veicolo o servizio proposto',
  'disponibilità definitiva',
  'periodo, luogo e logistica',
  'prezzo, sconti, cauzione e condizioni di pagamento',
  'personalizzazione, permessi, catering e costi non standard',
  'fornitori o mezzi esterni',
]);

export const COMMERCIAL_PROCEDURE = Object.freeze({
  version: COMMERCIAL_PROCEDURE_VERSION,
  incomplete_request: {
    status: 'Da integrare',
    behavior: [
      'Estrarre e conservare i dati certi nella stessa lead.',
      'Chiedere esclusivamente le informazioni mancanti.',
      'Preparare la risposta come bozza senza inviarla.',
      'Non creare preventivo o progetto finché i dati minimi non sono completi.',
    ],
  },
  creation_rules: {
    lead: 'Creare la lead appena la richiesta è commerciale e il mittente è identificabile.',
    partner: 'Creare una nuova anagrafica soltanto per un cliente identificato da ragione sociale o partita IVA; riutilizzare sempre quella esistente quando trovata.',
    draft: 'Creare una sola bozza e un solo progetto quando cliente, servizio, mezzo, luogo, periodo o durata, personalizzazione e budget consentono di preparare il prezzo.',
  },
  pietro_control: {
    rule: 'Nessuna comunicazione o azione esterna senza comando specifico e conferma finale di Pietro.',
    checks: PIETRO_FINAL_CHECKS,
  },
  duplicate_prevention: [
    'Messaggi: account, Message-ID e allegato.',
    'Anagrafiche: partita IVA, e-mail, dominio aziendale e ragione sociale normalizzata.',
    'Lead: mittente, oggetto normalizzato, cliente, luogo e periodo.',
    'Preventivi e progetti: opportunità CRM e chiave idempotente della pratica.',
    'In caso di corrispondenza ambigua sospendere la creazione e richiedere controllo, senza generare un duplicato.',
  ],
});

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function emailDomain(value) {
  const email = normalizeEmail(value);
  return email.includes('@') ? email.split('@').at(-1) : '';
}

export function normalizeCompanyName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeCommercialSubject(value) {
  return String(value || '').replace(/^\s*((re|r|fw|fwd)\s*:\s*)+/i, '').trim().toLowerCase();
}

export function missingDraftData(input) {
  const request = input.request || {};
  const customer = input.customer || {};
  const missing = [];
  if (!hasValue(request.service)) missing.push('service');
  if (!hasValue(request.asset)) missing.push('asset');
  if (!hasValue(request.location)) missing.push('location');
  if (!hasValue(request.start_at)) missing.push('start_at');
  if (!hasValue(request.end_at) && !hasValue(request.duration)) missing.push('end_at_or_duration');
  if (!hasValue(request.personalization)) missing.push('personalization');
  if (!hasValue(request.budget)) missing.push('budget');
  if (!hasValue(customer.name)) missing.push('customer.name');
  if (!hasValue(customer.email)) missing.push('customer.email');
  if (!hasValue(customer.existing_partner_id) && !hasValue(customer.vat) && !hasValue(customer.company_name)) {
    missing.push('customer.company_or_vat');
  }
  return missing;
}

export function sameCommercialCase(existing, incoming) {
  const oldCustomer = existing.customer || {};
  const newCustomer = incoming.customer || {};
  const sameVat = hasValue(oldCustomer.vat) && String(oldCustomer.vat) === String(newCustomer.vat || '');
  const sameEmail = normalizeEmail(oldCustomer.email) && normalizeEmail(oldCustomer.email) === normalizeEmail(newCustomer.email);
  const sameCompany = normalizeCompanyName(oldCustomer.company_name || oldCustomer.name)
    && normalizeCompanyName(oldCustomer.company_name || oldCustomer.name) === normalizeCompanyName(newCustomer.company_name || newCustomer.name);
  const sameDomain = emailDomain(oldCustomer.email) && emailDomain(oldCustomer.email) === emailDomain(newCustomer.email);
  const sameSubject = normalizeCommercialSubject(existing.normalized_subject) === normalizeCommercialSubject(incoming.normalized_subject);
  const samePlace = !existing.request?.location || !incoming.request?.location
    || String(existing.request.location).trim().toLowerCase() === String(incoming.request.location).trim().toLowerCase();
  const samePeriod = !existing.request?.start_at || !incoming.request?.start_at
    || String(existing.request.start_at) === String(incoming.request.start_at);
  return (sameVat || sameEmail || (sameCompany && sameDomain)) && sameSubject && samePlace && samePeriod;
}
