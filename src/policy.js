import crypto from 'node:crypto';

export const EXTERNAL_ACTIONS = new Set([
  'SEND_EMAIL', 'SEND_QUOTE', 'SEND_CONTRACT', 'ISSUE_INVOICE', 'SEND_INVOICE', 'TRANSMIT_SDI',
  'SEND_FOLLOW_UP', 'SEND_PAYMENT_REMINDER', 'SEND_NOTIFICATION', 'MAKE_PAYMENT', 'MAKE_REFUND',
  'RETURN_DEPOSIT', 'UNCERTAIN_BANK_MATCH', 'IRREVERSIBLE_ACTION',
]);

export class ApprovalService {
  constructor(store, secret = process.env.APPROVAL_SECRET || process.env.API_TOKEN || '') {
    this.store = store;
    this.secret = secret;
  }

  queue(input) {
    if (!EXTERNAL_ACTIONS.has(input.type)) throw new Error(`Tipo di azione esterna non ammesso: ${input.type}`);
    if (!input.idempotency_key || !input.target) throw new Error('idempotency_key e target sono obbligatori');
    return this.store.createAction(input);
  }

  approveCommand(id, actor, command) {
    const action = this.store.action(id);
    if (!action) throw new Error('Azione non trovata');
    if (action.status !== 'PENDING_APPROVAL') throw new Error(`Azione non approvabile nello stato ${action.status}`);
    if (String(actor).trim().toLowerCase() !== 'pietro') throw new Error('Solo Pietro può impartire il comando specifico');
    if (String(command).trim() !== `APPROVA ${id}`) throw new Error(`Comando specifico richiesto: APPROVA ${id}`);
    const nonce = crypto.randomBytes(24).toString('hex');
    const digest = crypto.createHmac('sha256', this.secret).update(`${id}:${nonce}`).digest('hex');
    this.store.updateAction(id, {
      status: 'AWAITING_FINAL_CONFIRMATION', actor: 'Pietro', command_approved_at: new Date().toISOString(),
      confirmation_digest: digest,
    });
    this.store.audit('ACTION_COMMAND_APPROVED', { action_id: id, actor: 'Pietro' });
    return { action: this.store.action(id), confirmation_token: `${nonce}.${digest}` };
  }

  confirm(id, actor, token) {
    const action = this.store.action(id);
    if (!action) throw new Error('Azione non trovata');
    if (action.status !== 'AWAITING_FINAL_CONFIRMATION') throw new Error(`Conferma non ammessa nello stato ${action.status}`);
    if (String(actor).trim().toLowerCase() !== 'pietro') throw new Error('Solo Pietro può dare la conferma finale');
    const [nonce, supplied] = String(token || '').split('.');
    const expected = crypto.createHmac('sha256', this.secret).update(`${id}:${nonce}`).digest('hex');
    if (!supplied || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      throw new Error('Token di conferma finale non valido');
    }
    if (action.confirmation_digest !== expected) throw new Error('La conferma non appartiene al comando specifico corrente');
    this.store.updateAction(id, {
      status: 'APPROVED_FOR_EXECUTION', final_confirmation_at: new Date().toISOString(), confirmation_digest: null,
    });
    this.store.audit('ACTION_FINAL_CONFIRMED', { action_id: id, actor: 'Pietro' });
    return this.store.action(id);
  }

  assertExecutable(id) {
    const action = this.store.action(id);
    if (!action || action.status !== 'APPROVED_FOR_EXECUTION') throw new Error('Azione bloccata: servono comando specifico e conferma finale');
    return action;
  }

  executed(id, result) {
    const action = this.assertExecutable(id);
    this.store.updateAction(id, { status: 'EXECUTED', executed_at: new Date().toISOString(), result });
    this.store.audit('ACTION_EXECUTED', { action_id: id, action_type: action.type, target: action.target });
    return this.store.action(id);
  }
}

export function withinOperatingWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return hour >= 8 && hour <= 19;
}
