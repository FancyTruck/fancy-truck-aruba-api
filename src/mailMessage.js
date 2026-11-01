import { MAX_POLL_SOURCE_BYTES } from './mailPolling.js';

// Used by the interactive message reader inside its readonly mailbox lock.
// Never hand an unbounded IMAP download stream to the MIME parser.
export async function readBoundedMessage({ client, uid, parse }) {
  const problem = (code, message) => Object.assign(new Error(message), { code });
  if (!Number.isSafeInteger(uid) || uid < 1) throw problem('INVALID_UID', 'UID non valido');
  const metadata = await client.fetchOne(uid, { size: true }, { uid: true });
  if (!Number.isSafeInteger(metadata?.size) || metadata.size < 0) {
    throw problem('MESSAGE_SIZE_UNAVAILABLE', 'Dimensione messaggio non verificabile');
  }
  if (metadata.size > MAX_POLL_SOURCE_BYTES) {
    throw problem('MAIL_SOURCE_LIMIT', 'Messaggio oltre 20 MiB: lettura sospesa');
  }
  const message = await client.fetchOne(uid, {
    source: { start: 0, maxLength: MAX_POLL_SOURCE_BYTES + 1 },
  }, { uid: true });
  if (!message?.source) throw problem('MESSAGE_UNAVAILABLE', 'Messaggio non disponibile');
  if (Buffer.byteLength(message.source) > MAX_POLL_SOURCE_BYTES) {
    throw problem('MAIL_SOURCE_LIMIT', 'Sorgente oltre 20 MiB: lettura sospesa');
  }
  return parse(message.source);
}
