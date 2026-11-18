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

// Test the sender's own request, not a sales call-to-action or a quoted brief.
function buyerRequest(body) {
  const service = /\b(?:food\s*truck|bar\s*truck|truck|airstream|horsebox|catering|roadshow|road\s*tour|brand activation|nolegg\w*|affittare|acquistare)\b/i;
  const wants = /\b(?:vorrei|vorremmo|avremmo bisogno|cerchiamo|ci servono?|necessitiamo|desideriamo|siamo interessati|would like|looking for|we need)\b/i;
  const selling = /(?:propor(?:vi|ti|le)|offrir(?:vi|ti|le)|presentar(?:vi|ti|le)|illustrar(?:vi|ti|le)|aiutar(?:vi|ti|la)|supportar(?:vi|ti|la)|far(?:vi|ti|le) conoscere)/i;
  return String(body).split(/[.!?;\n]+/).some(sentence=>service.test(sentence)&&((wants.test(sentence)&&!selling.test(sentence))||/(?:presentarvi|inviarvi|sottoporvi).{0,25}(?:brief|richiesta|progetto)/i.test(sentence)));
}

function supplierPitch(body) {
  const directOffer = /\b(?:offriamo|vi proponiamo|ti proponiamo|le proponiamo|we offer|our services include|we provide|we can help you)\b/i;
  const directedOffer = /\b(?:propor(?:vi|ti|le)|offrir(?:vi|ti|le)|presentar(?:vi|ti|le)|illustrar(?:vi|ti|le))\b/i;
  const recipientBenefit = /(?:aiutarvi a|aiutarti a|supportarvi (?:nella|con|per)|aumentare (?:le vostre|le tue) vendite|migliorare (?:la vostra|la tua) visibilit[aà]|acquisire (?:nuovi|più) clienti|grow your business|boost your sales)/i;
  const vendorIdentity = /(?:siamo (?:un['’]?|una|un)\s*(?:agenzia|societ[aà]|azienda)|siamo (?:fornitori|specializzati)|i nostri servizi|la nostra piattaforma|il nostro software|our platform|our software)/i;
  const salesInvitation = /(?:prenota(?:re)? (?:una |la )?(?:call|demo|consulenza)|fissare (?:una |un )?(?:call|incontro)|richiedi (?:una |un )?(?:demo|preventivo)|scopri (?:come|i nostri|la nostra)|consulenza gratuita|prova gratuita|free (?:trial|demo))/i;
  return directOffer.test(body)||directedOffer.test(body)||(vendorIdentity.test(body)&&(recipientBenefit.test(body)||salesInvitation.test(body)));
}

export function classifyCommercialMessage(subject = '', text = '', headers = new Map(), { isReply = false } = {}) {
  const title = String(subject).replace(/^(?:(?:re|r|fw|fwd|i)\s*:\s*)+/i, '');
  const body = currentMessage(text);
  const buying = buyerRequest(body), pitching = supplierPitch(body);
  const value = `${title}\n${body}`.toLowerCase().replace(/\bfancy\s*truck\b/g, '');
  const getHeader = (key) => String(headers?.get?.(key) || '').toLowerCase();
  if (getHeader('list-id') || getHeader('list-unsubscribe')
      || /bulk|list|junk/.test(getHeader('precedence'))
      || (getHeader('auto-submitted') && getHeader('auto-submitted') !== 'no')) {
    return { kind: null, reason: 'automatic_or_mailing_list' };
  }
  // A supplier answering OUR purchase request is not a customer asking to rent
  // OUR fleet. Quarantine direction conflicts before even linking an old lead.
  // No sender/domain blacklist: the same company may also be a real customer.
  const financePitch = /(?:scopri quanto credito|quanto credito puoi ottenere|(?:finanziament[oi]|credito).{0,60}(?:per la tua impresa|per la vostra impresa|per la tua azienda))/i.test(title);
  const consultingPitch = /business plan/i.test(title) && /(?:gratuit|consulenza|parlarne)/i.test(`${title} ${body}`);
  const supplierFulfilment = /(?:vostr[oa] (?:richiesta|cantiere)|presso la (?:nostra )?filiale)/i.test(body)
    && /(?:generatore|articolo proposto|nostr[oa] (?:mezzo|prodotto|attrezzatura))/i.test(body)
    && /(?:disponibil|redazione del preventivo|procedere)/i.test(body);
  const equipmentPitch = /(?:energia a bordo|riscaldamento|condizionatori|pannelli solari)/i.test(title)
    && /(?:scopri|richiedi informazioni|richiedi un preventivo|installiamo|proponiamo)/i.test(body)
    && !/(?:vorrei|vorremmo|cerchiamo).{0,80}(?:nolegg|food.?truck|airstream|brand activation|roadshow)/i.test(body);
  if (supplierFulfilment) return { kind: null, reason: 'non_customer_direction_requires_review' };
  if (financePitch || consultingPitch || equipmentPitch || pitching) {
    return { kind: null, reason: buying ? 'non_customer_direction_requires_review' : 'supplier_offer' };
  }
  // Transactional account messages often lack List-* / Auto-Submitted headers.
  // Match their purpose, never block an entire provider or sender domain.
  // A customer's own request/reply accompanying a notification stays eligible.
  const customerRequest = /\b(?:vorrei|vorremmo|avremmo bisogno|cerchiamo|ci serve|ci servono|necessitiamo|would like|looking for)\b/i;
  const prefixedConversation = isReply || /^\s*(?:re|r|fw|fwd|i)\s*:/i.test(String(subject));
  const serviceNotification = /\b(?:account login notification|(?:new|successful|suspicious) (?:account )?(?:login|sign[ -]?in)|(?:verify|confirm) (?:your )?e-?mail(?: address)?|(?:complete|finish) your .{0,60}account (?:setup|registration)|password (?:reset|changed)|reset (?:your )?password|(?:verification|security|one.time) code|accessi sospetti|autorizzazione bonifico(?: istantaneo)?|notifica (?:di )?accesso|verifica (?:il tuo indirizzo )?e-?mail|conferma (?:il tuo indirizzo )?e-?mail|codice (?:di )?(?:verifica|sicurezza)|reimposta(?:zione)? password)\b/i;
  if (!prefixedConversation && !customerRequest.test(body) && serviceNotification.test(title)) {
    return { kind: null, reason: 'automatic_service_notification' };
  }
  const fundingPromotion = /\b(?:brevetti|marchi|design|bandi|agevolazioni|incentivi)\b/i.test(title)
    && /\b(?:fondo perduto|fino al \d+\s*%|contributi a fondo)\b/i.test(title);
  if (!prefixedConversation && !customerRequest.test(body) && fundingPromotion) {
    return { kind: null, reason: 'administrative_or_marketing' };
  }
  const excludedTitle = /\b(?:fattur[ae]|estratto conto|ordine.{0,30}(?:conferm|spedit)|conferma.{0,25}ordine|spedito|consegnato|in consegna|documento disponibile|risoluzione richiesta assistenza|nuovo (?:accesso|dispositivo)|new login|preventiv[oi] riparazione|membership rewards|newsletter|black friday|coupon)\b/i;
  const marketing = /\b(?:disiscriviti|unsubscribe|offerta riservata|codice sconto|fino al \d+% di sconto)\b/i;
  if (excludedTitle.test(title) || marketing.test(body)) {
    return { kind: null, reason: 'administrative_or_marketing' };
  }
  // A company describing itself as an agency/supplier can still be a customer.
  // Its identity alone is never grounds to reject its own explicit request.
  // A forwarded quote is not a fresh request just because its subject says "preventivo".
  if (/^\s*(?:(?:re|r)\s*:\s*)*(?:fw|fwd|i)\s*:/i.test(String(subject))
      && !customerRequest.test(body)) {
    return { kind: null, reason: 'forward_requires_review' };
  }
  // A project brief may request our creative proposal without naming a truck model.
  const activationBrief = /\b(?:brand awareness|branding|attivazioni|concept)\b/i.test(body)
    && /\b(?:evento|eventi|giornate|mezzo)\b/i.test(body)
    && /\b(?:budget|costi|quotazione)\b/i.test(body)
    && /(?:mi affiderei a voi|da sviluppare|ci ha chiesto un.idea|vorremmo|avremmo bisogno)/i.test(body);
  if (activationBrief) return { kind: 'brand_activation', reason: 'explicit_commercial_request' };
  const service = catalogueModelsIn(value).length > 0 || /\b(?:food\s*truck|bar\s*truck|truck|airstream|horsebox|container|gazebo|ape|catering|road\s*tour|roadshow|brand activation|noleggio|noleggiare)\b/i.test(value);
  const intent = /\b(?:affittare|affitto|richiest[ae]|richied\w*|vorre[im]\w*|vorremmo|avremmo|cerchiamo|ci serv\w*|necessit\w*|preventiv[oi]|quotazion[ei]|disponibilit[aà]|informazioni|interessat[oi]|request|quote|looking for|would like|availability)\b/i.test(value);
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
