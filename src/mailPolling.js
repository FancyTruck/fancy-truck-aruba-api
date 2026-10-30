// Checkpoint only completed messages, in UID order. Stop on the first failure.
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
      if (!Number.isSafeInteger(metadata?.size) || metadata.size < 0) throw new Error('Dimensione messaggio non verificabile');
      if (metadata.size > 10 * 1024 * 1024) {
        if (!metadata.envelope) throw new Error('Metadati messaggio grande non disponibili');
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
        const next = { ...checkpoint, lastUid: uid };
        store.setCursor(key, next); checkpoint = next;
        rows.push({ suspended: true, uid, account, review_id: item.id, reason: 'large_message_requires_review' });
        continue;
      }
      const message = await client.fetchOne(uid, { source: { maxLength: 10 * 1024 * 1024 + 1 } }, { uid: true });
      if (!message?.source) throw new Error('Messaggio non disponibile: verifica necessaria');
      if (message.source.length > 10 * 1024 * 1024) throw new Error('Messaggio oltre il limite dichiarato: verifica necessaria');
      const parsed = await parse(message.source);
      const result = await processMessage(parsed, uid, validity);
      const next = { ...checkpoint, lastUid: uid };
      store.setCursor(key, next);
      checkpoint = next;
      rows.push(result);
    } catch (error) {
      rows.push({ suspended: true, retry_pending: true, uid,
        error: error instanceof Error ? error.message : 'errore sconosciuto' });
      break;
    }
  }
  return rows;
}
