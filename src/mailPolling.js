export const MAX_POLL_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_INLINE_SOURCE_BYTES = 10 * 1024 * 1024;
const mailProblem = (code, message) => Object.assign(new Error(message), { code });

// Checkpoint completed work OR a durably saved, recoverable review handoff.
// A review handoff never means body processing or an Odoo registration succeeded.
export async function pollMailbox({ client, account, store, parse, processMessage, now = Date.now() }) {
  const validity = String(client.mailbox?.uidValidity || '');
  if (!validity) throw new Error('UIDVALIDITY non disponibile: controllo sospeso');
  const key = `imap:${account}:checkpoint`;
  let checkpoint = store.cursor(key);
  if (!checkpoint) {
    checkpoint = {
      uidValidity: validity,
      lastUid: Number(store.cursor(`imap:${account}:last_uid`, 0)),
      initialSince: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    };
    store.setCursor(key, checkpoint);
  }
  if (checkpoint.uidValidity !== validity) {
    throw new Error('UIDVALIDITY cambiato: riconciliare la casella prima di riprendere');
  }
  const query = checkpoint.lastUid > 0
    ? { uid: `${checkpoint.lastUid + 1}:*` }
    : { since: new Date(checkpoint.initialSince) };
  const found = await client.search(query, { uid: true });
  const candidates = [...new Set(found || [])].map(Number)
    .filter(uid => Number.isSafeInteger(uid) && uid > checkpoint.lastUid)
    .sort((a, b) => a - b).slice(0, 100);
  const rows = [];
  for (const uid of candidates) {
    try {
      // Inspect metadata before buffering attachments; a 150 MB email can kill a 512 MB worker.
      const metadata = await client.fetchOne(uid, { size: true, envelope: true }, { uid: true });
      if (!Number.isSafeInteger(metadata?.size) || metadata.size < 0) throw mailProblem('MESSAGE_SIZE_UNAVAILABLE', 'Dimensione messaggio non verificabile');
      if (metadata.size > MAX_INLINE_SOURCE_BYTES) {
        if (!metadata.envelope) throw mailProblem('MAIL_SOURCE_LIMIT', 'Messaggio grande senza metadati recuperabili: checkpoint conservato');
        const env = metadata.envelope;
        const { item } = store.queueClassification({
          source_key: JSON.stringify(['large-message', account, validity, uid]),
          account: account.split(':sent:')[0], mailbox: account.includes(':sent:') ? account.split(':sent:')[1] : 'INBOX',
          uid, uid_validity: validity, message_id: env.messageId || null,
          sender: env.from?.[0]?.address || '', subject: env.subject || '',
          excerpt: 'Messaggio conservato su Aruba. Corpo e allegati non scaricati: verifica manuale necessaria.',
          reason: 'large_message_requires_review', size: metadata.size, candidate_ids: [],
        });
        // Only advance once the recoverable review is persisted. Never mark it processed in Odoo.
        store.recordMailOutcome?.(account, validity, uid, {suspended:true,content_processed:false,review_id:item.id,reason:item.reason || "large_message_requires_review"});
        const next = { ...checkpoint, lastUid: uid };
        store.setCursor(key, next); checkpoint = next;
        rows.push({ suspended: true, content_processed: false, uid, account, review_id: item.id, reason: 'large_message_requires_review' });
        continue;
      }
      const message = await client.fetchOne(uid, { source: { start: 0, maxLength: MAX_INLINE_SOURCE_BYTES + 1 } }, { uid: true });
      if (!message?.source) throw new Error('Messaggio non disponibile: verifica necessaria');
      if (Buffer.byteLength(message.source) > MAX_INLINE_SOURCE_BYTES) throw mailProblem('MAIL_SOURCE_LIMIT', 'Messaggio oltre il limite dichiarato: checkpoint conservato');
      const parsed = await parse(message.source);
      const result = await processMessage(parsed, uid, validity);
      store.recordMailOutcome?.(account, validity, uid, result);
      const next = { ...checkpoint, lastUid: uid };
      store.setCursor(key, next);
      checkpoint = next;
      rows.push({...result, uid, account});
    } catch (error) {
      try { store.recordMailOutcome?.(account, validity, uid, {retry_pending:true,error:error.message}); } catch {}
      rows.push({ suspended: true, retry_pending: true, uid, code: error?.code || 'MAIL_PROCESSING_FAILED',
        error: error instanceof Error ? error.message : 'errore sconosciuto' });
      break;
    }
  }
  return rows;
}
