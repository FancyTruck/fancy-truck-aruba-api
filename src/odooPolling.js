export async function pollOdooMessages({ store, search, processMessage, now = Date.now() }) {
  const key = 'odoo:crm:messages:checkpoint';
  let checkpoint = store.cursor(key);
  if (!checkpoint) {
    checkpoint = { lastId: 0, since: new Date(now - 30 * 60000).toISOString().replace('T', ' ').slice(0, 19) };
    store.setCursor(key, checkpoint);
  }
  const domain = [['model', '=', 'crm.lead'], ['message_type', '=', 'email'],
    ...(checkpoint.lastId ? [['id', '>', checkpoint.lastId]] : [['date', '>=', checkpoint.since]])];
  const messages = await search(domain);
  const rows = [];
  for (const message of messages.slice().sort((a, b) => a.id - b.id)) {
    if (message.id <= checkpoint.lastId) continue;
    try {
      const result = await processMessage(message);
      const next = { ...checkpoint, lastId: message.id };
      store.setCursor(key, next);
      checkpoint = next;
      rows.push(result);
    } catch (error) {
      rows.push({ suspended: true, retry_pending: true, message_id: message.id,
        error: error instanceof Error ? error.message : 'errore sconosciuto' });
      break;
    }
  }
  return rows;
}
