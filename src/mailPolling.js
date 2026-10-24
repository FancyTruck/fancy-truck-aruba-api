export const MAX_POLL_SOURCE_BYTES = 20 * 1024 * 1024;

function mailProblem(code, message) {
  return Object.assign(new Error(message), { code });
}

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
      // Check size before fetching MIME, including for the sent-mail consumer.
      // Do not advance this business checkpoint over content not processed.
      const metadata = await client.fetchOne(uid, { size: true }, { uid: true });
      if (!Number.isSafeInteger(metadata?.size) || metadata.size < 0) {
        throw mailProblem('MESSAGE_SIZE_UNAVAILABLE', 'Dimensione messaggio non verificabile');
      }
      if (metadata.size > MAX_POLL_SOURCE_BYTES) {
        throw mailProblem('MAIL_SOURCE_LIMIT', 'Messaggio oltre 20 MiB: revisione necessaria, checkpoint conservato');
      }
      const message = await client.fetchOne(uid, {
        source: { start: 0, maxLength: MAX_POLL_SOURCE_BYTES + 1 },
      }, { uid: true });
      if (!message?.source) throw new Error('Messaggio non disponibile: verifica necessaria');
      if (Buffer.byteLength(message.source) > MAX_POLL_SOURCE_BYTES) {
        throw mailProblem('MAIL_SOURCE_LIMIT', 'Sorgente oltre 20 MiB: revisione necessaria, checkpoint conservato');
      }
      const parsed = await parse(message.source);
      const result = await processMessage(parsed, uid, validity);
      const next = { ...checkpoint, lastUid: uid };
      store.setCursor(key, next);
      checkpoint = next;
      rows.push(result);
    } catch (error) {
      rows.push({ suspended: true, retry_pending: true, uid, code: error?.code || 'MAIL_PROCESSING_FAILED',
        error: error instanceof Error ? error.message : 'errore sconosciuto' });
      break;
    }
  }
  return rows;
}

