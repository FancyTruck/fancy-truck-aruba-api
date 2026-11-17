import crypto from 'node:crypto';

// An uncertain external write must never be repeated automatically.
export async function runMailOperation({ store, account, mailbox = 'INBOX', validity, uid, parsed, execute, retrySuspended = false }) {
  // The same RFC message can arrive through IMAP and the Odoo chatter.
  const source = JSON.stringify(parsed.messageId
    ? ['message-id', String(parsed.messageId).trim()]
    : [account, mailbox, `${validity}:${uid}`]);
  const key = crypto.createHash('sha256').update(source).digest('hex');
  const previous = store.state.mail_operations[key];
  const retryable = retrySuspended && previous?.status === 'COMPLETED' && (
    (parsed.websiteForm && previous.result?.skipped && previous.result.reason === 'mittente interno o automatico')
    || (previous.result?.suspended && previous.result.review_id && store.state.classification_reviews[previous.result.review_id] && !store.state.classification_reviews[previous.result.review_id]?.operation_id));
  if (previous?.status === 'COMPLETED' && !retryable) return { ...previous.result, duplicate: true };
  if (previous && !retryable) {
    const { item } = store.queueClassification({
      source_key: `partial:${key}`, account, mailbox, uid,
      uid_validity: validity, message_id: parsed.messageId || null,
      sender: parsed.from?.value?.[0]?.address || '',
      subject: String(parsed.subject || '').slice(0, 500),
      reason: 'previous_operation_outcome_uncertain', operation_id: key,
    });
    return { suspended: true, review_id: item.id, reason: item.reason };
  }
  if(retryable)store.audit('MAIL_CLASSIFICATION_RETRY',{account,uid,previous_result:previous.result});
  const started = { status: 'STARTED', started_at: new Date().toISOString(), account, uid, validity };
  store.saveMailOperation(key, started);
  const result = await execute();
  store.saveMailOperation(key, { ...started, status: 'COMPLETED', result,
    completed_at: new Date().toISOString() });
  return result;
}
