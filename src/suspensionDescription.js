const reasons = {
  new_thread_existing_customer: 'Nuova conversazione con cliente esistente: collegamento alla pratica da verificare',
  outgoing_multiple_recipients: 'Email inviata con più destinatari: collegamento alla pratica da verificare',
  outgoing_thread_unmatched: 'Email inviata senza pratica corrispondente identificata',
  forward_requires_review: 'Messaggio inoltrato: pertinenza commerciale da verificare',
  commercial_intent_not_established: 'Finalità commerciale non determinata: classificazione richiesta',
};

export function describeSuspension(source, row = {}) {
  const reference = Number.isSafeInteger(row.uid) ? ` UID ${row.uid}` :
    row.review_id ? ` revisione ${row.review_id}` : '';
  const detail = row.error || reasons[row.reason] || row.reason || row.code ||
    'Revisione necessaria: motivo non disponibile';
  return `${source}${reference}: ${detail}`;
}
