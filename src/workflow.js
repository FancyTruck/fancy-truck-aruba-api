import crypto from 'node:crypto';

export const PIPELINE = [
  'Nuove richieste', 'Qualificate', 'Preventivo inviato', 'Revisione del preventivo',
  'Preventivo accettato', 'Invio del contratto', 'Ricezione contratto firmato', 'Invio fattura',
  'Ricezione pagamento parziale', 'Ricezione pagamento completa', 'Attività in esecuzione',
  'Cauzione da rendere', 'Completata',
];

const REQUIRED_REQUEST = ['service', 'asset', 'location', 'start_at', 'end_at', 'delivery', 'recovery', 'logistics'];
const REQUIRED_CUSTOMER = ['name', 'email', 'address', 'phone'];

function workdayAfter(date, days) {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (![0, 6].includes(result.getUTCDay())) remaining -= 1;
  }
  return result;
}

export class FancyTruckWorkflow {
  constructor({ store, approvals, adapter }) {
    this.store = store;
    this.approvals = approvals;
    this.adapter = adapter;
  }

  missing(input) {
    const missing = [];
    for (const key of REQUIRED_REQUEST) if (!input.request?.[key]) missing.push(key);
    for (const key of REQUIRED_CUSTOMER) if (!input.customer?.[key]) missing.push(`customer.${key}`);
    if (!input.customer?.vat && !input.customer?.fiscal_code) missing.push('customer.vat_or_fiscal_code');
    if (!input.customer?.sdi) missing.push('customer.sdi');
    if (!input.customer?.pec) missing.push('customer.pec');
    return missing;
  }

  async receiveCommercialRequest(input) {
    const key = `email:${input.account}:${input.message_id}:${input.attachment_id || '-'}`;
    const remembered = this.store.state.idempotency[key];
    if (remembered) return { duplicate: true, ...remembered.result };
    const subject = String(input.subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim().toLowerCase();
    let item = this.store.findCase((row) => row.active !== false && row.customer?.email === input.customer?.email
      && row.normalized_subject === subject);
    let created = false;
    if (!item) {
      item = this.store.createCase({
        stage: 'Nuove richieste', active: true, normalized_subject: subject,
        source_messages: [], customer: {}, request: {}, documents: {}, invoices: [], payments: [], costs: [],
      }).item;
      created = true;
    }
    const customer = { ...item.customer, ...Object.fromEntries(Object.entries(input.customer || {}).filter(([, value]) => value)) };
    const request = { ...item.request, ...Object.fromEntries(Object.entries(input.request || {}).filter(([, value]) => value)) };
    const sourceMessages = [...new Set([...(item.source_messages || []), input.message_id])];
    this.store.updateCase(item.id, { customer, request, source_messages: sourceMessages });
    const missing = this.missing({ customer, request });
    if (missing.length) {
      const queued = this.approvals.queue({
        type: 'SEND_EMAIL', target: customer.email,
        idempotency_key: `missing:${item.id}:${missing.sort().join(',')}`,
        case_id: item.id, payload: { channel: 'odoo_chatter', missing },
      });
      this.store.updateCase(item.id, { pending_missing: missing, pending_action_id: queued.action.id });
      const result = { case_id: item.id, lead_created: created, missing, action_id: queued.action.id };
      this.store.remember(key, result);
      return result;
    }
    const result = await this.prepareDraft(item.id, key);
    this.store.remember(key, result);
    return { case_id: item.id, lead_created: created, ...result };
  }

  async prepareDraft(caseId, sourceKey) {
    const item = this.store.case(caseId);
    if (item.documents?.quote) return { duplicate: true, quote: item.documents.quote, project: item.documents.project };
    const remote = await this.adapter.createDraftBundle({
      case: item, idempotency_key: `quote-project:${caseId}`, task_name: '00 – RIEPILOGO ECONOMICO',
    });
    const quote = remote.quote || { id: crypto.randomUUID(), state: 'draft' };
    const project = remote.project || { id: crypto.randomUUID(), task_name: '00 – RIEPILOGO ECONOMICO' };
    this.store.updateCase(caseId, {
      stage: 'Qualificate', pending_missing: [],
      documents: { ...item.documents, quote, project },
      source_key: sourceKey,
    });
    const review = this.approvals.queue({
      type: 'SEND_QUOTE', target: item.customer.email, case_id: caseId,
      idempotency_key: `send-quote:${quote.id}`,
      payload: { quote_id: quote.id, checks: ['cliente', 'prodotto', 'disponibilità', 'periodo', 'prezzo', 'cauzione', 'pagamento', 'personalizzazione', 'logistica', 'condizioni'] },
    });
    return { quote, project, ready_for_review: true, action_id: review.action.id };
  }

  setStage(caseId, stage, options = {}) {
    const item = this.store.case(caseId);
    if (stage === 'Stand-by') {
      if (!options.recontact_at) throw new Error('Stand-by richiede una data certa di ricontatto');
      return this.store.updateCase(caseId, { stage, recontact_at: options.recontact_at });
    }
    const current = PIPELINE.indexOf(item.stage);
    const next = PIPELINE.indexOf(stage);
    if (next < 0) throw new Error(`Fase non valida: ${stage}`);
    if (current >= 0 && next < current) throw new Error('Non è consentito retrocedere una fase corretta');
    return this.store.updateCase(caseId, { stage, ...(options.won ? { won: true } : {}) });
  }

  recordQuoteSent(caseId, sentAt, expiresAt) {
    const item = this.setStage(caseId, 'Preventivo inviato');
    const followups = [
      { kind: 'first', due: workdayAfter(new Date(sentAt), 1) },
      { kind: 'second', due: workdayAfter(new Date(sentAt), 6) },
      { kind: 'last', due: new Date(new Date(expiresAt).getTime() - 2 * 86400000) },
    ].map((row) => ({ ...row, due: row.due.toISOString(), status: 'SCHEDULED' }));
    return this.store.updateCase(item.id, { quote_sent_at: sentAt, quote_expires_at: expiresAt, followups });
  }

  queueDueFollowups(caseId, now = new Date()) {
    const item = this.store.case(caseId);
    if (item.customer_responded || item.quote_status && item.quote_status !== 'sent') return [];
    const queued = [];
    for (const row of item.followups || []) {
      if (row.status !== 'SCHEDULED' || new Date(row.due) > now) continue;
      const result = this.approvals.queue({ type: 'SEND_FOLLOW_UP', target: item.customer.email, case_id: caseId,
        idempotency_key: `follow-up:${caseId}:${row.kind}:${row.due}`, payload: { kind: row.kind } });
      row.status = 'PENDING_APPROVAL'; row.action_id = result.action.id; queued.push(result.action);
    }
    this.store.updateCase(caseId, { followups: item.followups });
    return queued;
  }

  expireQuote(caseId) {
    const item = this.store.case(caseId);
    const hasFollowOn = item.customer_responded || item.quote_status === 'accepted' || item.documents?.contract
      || item.invoices.length || item.payments.length || item.delivery_started_at || item.extension_at;
    if (hasFollowOn) return { expired: false };
    this.store.updateCase(caseId, { active: false, stage: 'Persa – Preventivo scaduto', quote_status: 'expired' });
    return { expired: true };
  }

  async acceptQuote(caseId, input = {}) {
    const item = this.setStage(caseId, 'Preventivo accettato', { won: true });
    const template = item.request.service === 'rental' ? 'Contratto di noleggio' : 'Roadtour/Brand Activation';
    const contract = await this.adapter.prepareContract({ case: item, template, idempotency_key: `contract:${caseId}` });
    this.store.updateCase(caseId, { quote_status: 'accepted', documents: { ...item.documents, contract } });
    const action = this.approvals.queue({ type: 'SEND_CONTRACT', target: item.customer.email, case_id: caseId,
      idempotency_key: `send-contract:${contract.id}`, payload: { contract_id: contract.id, template } }).action;
    return { contract, action };
  }

  async contractReturned(caseId, input) {
    const item = this.store.case(caseId);
    for (const field of ['customer', 'vat', 'quote_id', 'amount', 'period', 'location', 'asset']) {
      if (input.verified?.[field] !== true) throw new Error(`Coerenza non verificata: ${field}`);
    }
    this.setStage(caseId, 'Ricezione contratto firmato');
    const invoice = await this.adapter.prepareInvoiceDraft({ case: item, input, idempotency_key: `invoice-draft:${input.number || input.kind}:${caseId}` });
    const invoices = [...item.invoices, { ...invoice, status: 'draft', paid: 0, residual: Number(invoice.total) }];
    this.store.updateCase(caseId, { invoices });
    const action = this.approvals.queue({ type: 'ISSUE_INVOICE', target: 'Sistemi.cloud/SDI', case_id: caseId,
      idempotency_key: `issue-invoice:${invoice.id}`, payload: { invoice_id: invoice.id } }).action;
    return { invoice, action };
  }

  recordPayment(caseId, input) {
    const item = this.store.case(caseId);
    if (!input.certain_match) {
      const action = this.approvals.queue({ type: 'UNCERTAIN_BANK_MATCH', target: 'Sistemi.cloud/Odoo', case_id: caseId,
        idempotency_key: `uncertain-payment:${input.account}:${input.date}:${input.amount}:${input.trn}`, payload: input }).action;
      return { recorded: false, action };
    }
    const key = `payment:${input.account}:${input.date}:${input.amount}:${input.trn}`;
    if (this.store.has(key)) return { recorded: false, duplicate: true };
    const index = item.invoices.findIndex((row) => row.id === input.invoice_id);
    if (index < 0) throw new Error('Fattura non trovata');
    const invoice = { ...item.invoices[index] };
    invoice.paid = Math.min(Number(invoice.total), Number(invoice.paid) + Number(input.amount));
    invoice.residual = Number((Number(invoice.total) - invoice.paid).toFixed(2));
    invoice.status = invoice.residual === 0 ? 'paid' : 'partial';
    const invoices = [...item.invoices]; invoices[index] = invoice;
    const payments = [...item.payments, input];
    const allPaid = invoices.length > 0 && invoices.every((row) => row.residual === 0);
    this.store.updateCase(caseId, { invoices, payments, stage: allPaid ? 'Ricezione pagamento completa' : 'Ricezione pagamento parziale' });
    this.store.remember(key, { case_id: caseId, invoice_id: invoice.id });
    return { recorded: true, invoice, all_paid: allPaid };
  }

  queueOverdueReminder(caseId, invoiceId, now = new Date()) {
    const item = this.store.case(caseId);
    const invoice = item.invoices.find((row) => row.id === invoiceId);
    if (!invoice || invoice.residual <= 0 || invoice.credit_note || invoice.disputed || invoice.suspended || !item.customer.email) return null;
    if (new Date(invoice.due_at) > now) return null;
    return this.approvals.queue({ type: 'SEND_PAYMENT_REMINDER', target: item.customer.email, case_id: caseId,
      idempotency_key: `reminder:${invoice.id}:${now.toISOString().slice(0, 10)}`,
      payload: { invoice_id: invoice.id, total: invoice.total, paid: invoice.paid, residual: invoice.residual, iban: process.env.FANCY_TRUCK_IBAN ? 'configured' : 'missing' } }).action;
  }

  confirmDelivery(caseId, input) {
    if (!input.confirmed_by_pietro) throw new Error('La data prevista non basta: serve conferma di Pietro');
    const item = this.setStage(caseId, 'Attività in esecuzione');
    return this.store.updateCase(caseId, { delivery_started_at: input.at, delivery_report: input.report || null, costs: input.costs || item.costs });
  }

  confirmReturn(caseId, input) {
    if (!input.confirmed_by_pietro) throw new Error('Serve conferma di Pietro per la riconsegna');
    const item = this.store.case(caseId);
    return this.store.updateCase(caseId, { returned_at: input.at, return_report: input.report || null, damages: input.damages || [], extras: input.extras || [] });
  }

  closeOrQueueDeposit(caseId) {
    const item = this.store.case(caseId);
    const allPaid = item.invoices.length > 0 && item.invoices.every((row) => row.residual === 0);
    if (!item.returned_at || !allPaid) throw new Error('Riconsegna e saldo integrale sono obbligatori');
    if (!item.request.deposit) return this.setStage(caseId, 'Completata');
    this.setStage(caseId, 'Cauzione da rendere');
    return this.approvals.queue({ type: 'RETURN_DEPOSIT', target: item.customer.email, case_id: caseId,
      idempotency_key: `return-deposit:${caseId}:${item.request.deposit}`, payload: { amount: item.request.deposit } }).action;
  }
}

export class NullAdapter {
  async createDraftBundle() { return {}; }
  async prepareContract() { return { id: crypto.randomUUID(), state: 'draft' }; }
  async prepareInvoiceDraft({ input }) { return { id: crypto.randomUUID(), number: input.number || null, total: Number(input.total), due_at: input.due_at }; }
}
