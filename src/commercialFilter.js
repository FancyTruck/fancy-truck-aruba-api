import { catalogueModelsIn } from './vehicleCatalogue.js';
// Conservative admission gate for NEW opportunities, not an email deletion rule.
export function currentMessage(text = '') {
  const lines = String(text).split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    if (/^\s*(?:--\s*$|_{5,}|-{5,}|Il giorno .+ha scritto:|On .+wrote:|Da:\s|From:\s|Inviato:\s|Sent:\s|(?:cordiali saluti|distinti saluti|best regards|kind regards)[,.!]?\s*$)/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    result.push(line);
  }
  return result.join('\n');
}

export function classifyCommercialMessage(subject = '', text = '', headers = new Map()) {
  const title = String(subject).replace(/^(?:(?:re|r|fw|fwd|i)\s*:\s*)+/i, '');
  const body = currentMessage(text);
  const value = `${title}\n${body}`.toLowerCase().replace(/\bfancy\s*truck\b/g, '');
  const getHeader = (key) => String(headers?.get?.(key) || '').toLowerCase();
  if (getHeader('list-id') || getHeader('list-unsubscribe')
      || /bulk|list|junk/.test(getHeader('precedence'))
      || (getHeader('auto-submitted') && getHeader('auto-submitted') !== 'no')) {
    return { kind: null, reason: 'automatic_or_mailing_list' };
  }
  const excludedTitle = /\b(?:fattur[ae]|estratto conto|ordine.{0,30}(?:conferm|spedit)|conferma.{0,25}ordine|spedito|consegnato|in consegna|documento disponibile|risoluzione richiesta assistenza|nuovo (?:accesso|dispositivo)|new login|preventiv[oi] riparazione|membership rewards|newsletter)\b/i;
  const marketing = /\b(?:disiscriviti|unsubscribe|offerta riservata|codice sconto|fino al \d+% di sconto)\b/i;
  if (excludedTitle.test(title) || marketing.test(body)) {
    return { kind: null, reason: 'administrative_or_marketing' };
  }
  const supplierOffer = /\b(?:offriamo|vi proponiamo|siamo fornitori|siamo specializzati|we offer)\b/i;
  const customerRequest = /\b(?:vorrei|vorremmo|avremmo bisogno|cerchiamo|ci serve|ci servono|necessitiamo|would like|looking for)\b/i;
  if (supplierOffer.test(body) && !customerRequest.test(body)) {
    return { kind: null, reason: 'supplier_offer' };
  }
  // A forwarded quote is not a fresh request just because its subject says "preventivo".
  if (/^\s*(?:(?:re|r)\s*:\s*)*(?:fw|fwd|i)\s*:/i.test(String(subject))
      && !customerRequest.test(body)) {
    return { kind: null, reason: 'forward_requires_review' };
  }
  const service = catalogueModelsIn(value).length > 0 || /\b(?:food\s*truck|bar\s*truck|truck|airstream|horsebox|container|gazebo|ape|catering|road\s*tour|roadshow|brand activation|noleggio|noleggiare)\b/i.test(value);
  const intent = /\b(?:richiest[ae]|richied\w*|vorre[im]\w*|vorremmo|avremmo|cerchiamo|ci serv\w*|necessit\w*|preventiv[oi]|quotazion[ei]|disponibilit[aà]|informazioni|interessat[oi]|request|quote|looking for|would like|availability)\b/i.test(value);
  const eventFood = /\b(?:partecip\w*|adesion\w*)\b/i.test(value) && /\b(?:street\s*food|food|festival|fiera)\b/i.test(value);
  if (eventFood) return { kind: 'event_food', reason: 'explicit_commercial_request' };
  if (/\b(?:brand activation|road\s*tour|roadshow)\b/i.test(value) && intent) return { kind: 'brand_activation', reason: 'explicit_commercial_request' };
  if (/\bcatering\b/i.test(value) && intent) return { kind: 'catering', reason: 'explicit_commercial_request' };
  const eventRequest = /\b(?:evento|eventi|matrimonio|fiera|festival|inaugurazione)\b/i.test(body)
    && /\b(?:informazioni|preventivo|quotazione|vorrei|vorremmo|cerchiamo|avremmo bisogno)\b/i.test(body);
  if (!service && eventRequest) return { kind: 'unknown', reason: 'incomplete_commercial_request' };
  if (!service || !intent) return { kind: null, reason: 'commercial_intent_not_established' };
  const kind = /\b(?:road\s*tour|roadshow|brand activation|acquist\w*|comprare|purchase|buy)\b/i.test(value) ? 'sale' : 'rental';
  return { kind, reason: 'explicit_commercial_request' };
}
