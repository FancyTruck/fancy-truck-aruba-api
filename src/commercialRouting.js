import { classifyCommercialMessage, currentMessage } from './commercialFilter.js';

// Resolve the admission decision before any CRM contact or opportunity writes.
export async function routeCommercialMessage({ parsed, uid, account, uidValidity, store, findLead }) {
  const sender = String(parsed.from?.value?.[0]?.address || '').trim().toLowerCase();
  if (!sender || sender.endsWith('@fancytruck.it') || /no-?reply|mailer-daemon/.test(sender)) {
    return { action: 'skip', reason: 'mittente interno o automatico' };
  }
  if (sender === 'grafichefancytruck@gmail.com' && /FANCY-AI-(?:COLLAUDO|ROUTED-INTAKE)/i.test(String(parsed.subject || ''))) {
    return { action: 'skip', reason: 'authorized_test_message' };
  }
  const classification = classifyCommercialMessage(parsed.subject, parsed.text, parsed.headers);
  if (['automatic_or_mailing_list', 'administrative_or_marketing', 'supplier_offer'].includes(classification.reason)) {
    return { action: 'skip', reason: classification.reason };
  }
  const queue = (reason, candidates = []) => {
    const { item, duplicate } = store.queueClassification({
      source_key: JSON.stringify([account, 'INBOX', parsed.messageId || `uid:${uidValidity || 'legacy'}:${uid}`]),
      account, mailbox: 'INBOX', uid, uid_validity: uidValidity || null, message_id: parsed.messageId || null,
      sender, subject: String(parsed.subject || '').slice(0, 500),
      excerpt: currentMessage(parsed.text).slice(0, 4000),
      reason, candidate_ids: candidates,
    });
    return { action: 'review', review_id: item.id, duplicate, reason };
  };
  if (classification.reason === 'forward_requires_review') return queue(classification.reason);
  const isReply = /^\s*(re|r)\s*:/i.test(String(parsed.subject || ''))
    || Boolean(parsed.inReplyTo || parsed.references?.length);
  if (!classification.kind && !isReply) return queue(classification.reason);
  const match = await findLead(sender, parsed.subject);
  if (match.ambiguous) return queue('multiple_matching_leads', match.candidate_ids || []);
  if (match.lead) return { action: 'reply', lead: match.lead };
  if (isReply || !classification.kind) return queue('reply_without_matching_lead');
  return { action: 'create', kind: classification.kind };
}
