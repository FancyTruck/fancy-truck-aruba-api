import { classifyCommercialMessage } from './commercialFilter.js';
import { assertWritable } from './runtime.js';

// Separate from the approval executor: cannot send quotes or arbitrary queued actions.
export async function sendMissingInfoReply({ store, runtime, enabled, leadId, parsed, html, send }) {
  if (!enabled) return { sent: false, reason: 'disabled' };
  assertWritable(runtime);
  const recipient = String(parsed?.from?.value?.[0]?.address || '').trim().toLowerCase();
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient)
      || /(?:no-?reply|mailer-daemon)/i.test(recipient) || recipient.endsWith('@fancytruck.it')) {
    return { sent: false, reason: 'unsafe_recipient' };
  }
  if (!classifyCommercialMessage(parsed.subject, parsed.text, parsed.headers).kind) {
    return { sent: false, reason: 'not_commercial' };
  }
  const key = `auto-missing-info-v1:${leadId}`;
  if (store.has(key)) return { sent: false, reason: 'already_attempted' };
  // Reserve durably BEFORE SMTP. An uncertain delivery must be reviewed, never retried blindly.
  store.remember(key, { status: 'ATTEMPTING', lead_id: leadId });
  try {
    const info = await send({
      to: recipient,
      subject: `Re: ${String(parsed.subject || 'Richiesta preventivo').replace(/[\r\n]/g, ' ').slice(0, 200)}`,
      html,
      inReplyTo: parsed.messageId || undefined,
      references: parsed.messageId || undefined,
      headers: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
    });
    const sent = Boolean(info.accepted?.length) && !info.rejected?.length;
    store.audit(sent ? 'AUTO_MISSING_INFO_SENT' : 'AUTO_MISSING_INFO_REVIEW_REQUIRED',
      { lead_id: leadId, message_id: info.messageId || null });
    return { sent, reason: sent ? 'sent' : 'delivery_not_confirmed' };
  } catch {
    store.audit('AUTO_MISSING_INFO_REVIEW_REQUIRED', { lead_id: leadId });
    return { sent: false, reason: 'delivery_uncertain' };
  }
}
