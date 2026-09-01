import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JsonStateStore } from '../src/store.js';
import { ApprovalService } from '../src/policy.js';
import { FancyTruckWorkflow } from '../src/workflow.js';

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fancy-truck-'));
  const store = new JsonStateStore(path.join(directory, 'state.json'));
  const approvals = new ApprovalService(store, 'test-secret');
  const calls = [];
  const adapter = {
    async createDraftBundle(input) {
      calls.push(['draft', input]);
      return { quote: { id: 'S00123', state: 'draft' }, project: { id: 'P1', task_name: input.task_name } };
    },
    async prepareContract(input) { calls.push(['contract', input]); return { id: 'C1', state: 'draft' }; },
    async prepareInvoiceDraft({ input }) {
      calls.push(['invoice', input]);
      return { id: input.id || 'F1', number: input.number, total: Number(input.total), due_at: input.due_at };
    },
  };
  return { store, approvals, calls, workflow: new FancyTruckWorkflow({ store, approvals, adapter }) };
}

const base = {
  account: 'hello', message_id: '<m1@example.test>', subject: 'Preventivo evento Milano',
  customer: { name: 'Cliente Test', email: 'cliente@example.test' },
  request: { service: 'rental' },
};

const complete = {
  account: 'hello', message_id: '<m2@example.test>', subject: 'Re: Preventivo evento Milano',
  customer: { name: 'Cliente Test', email: 'cliente@example.test', address: 'Via Test 1, Milano', phone: '+3901000000', vat: '01234567890', sdi: 'ABC1234', pec: 'cliente@pec.test' },
  request: { service: 'rental', asset: 'Fiat 238', location: 'Milano', start_at: '2026-09-10T09:00:00+02:00', end_at: '2026-09-11T18:00:00+02:00', personalization: 'wrapping parziale', budget: 10000, delivery: 'Fancy Truck', recovery: 'Fancy Truck', logistics: 'A/R Genova', deposit: 1000 },
};

test('richiesta incompleta crea una lead, accoda la domanda e non invia', async () => {
  const { workflow, store } = setup();
  const first = await workflow.receiveCommercialRequest(base);
  assert.equal(first.lead_created, true);
  assert.ok(first.missing.length > 0);
  assert.equal(store.case(first.case_id).stage, 'Da integrare');
  assert.equal(store.action(first.action_id).status, 'PENDING_APPROVAL');
  const repeated = await workflow.receiveCommercialRequest(base);
  assert.equal(repeated.duplicate, true);
  assert.equal(Object.keys(store.snapshot().cases).length, 1);
  assert.equal(Object.keys(store.snapshot().actions).length, 1);
});

test('stesso cliente e progetto senza prefisso Re aggiorna la pratica esistente', async () => {
  const { workflow, store } = setup();
  const first = await workflow.receiveCommercialRequest(base);
  const followOn = await workflow.receiveCommercialRequest({
    ...complete, message_id: '<m3@example.test>', subject: 'Preventivo evento Milano',
  });
  assert.equal(followOn.case_id, first.case_id);
  assert.equal(Object.keys(store.snapshot().cases).length, 1);
  assert.equal(store.action(first.action_id).status, 'CANCELLED');
  assert.equal(store.action(first.action_id).cancel_reason, 'REQUEST_COMPLETED');
});

test('una nuova lista di dati mancanti sostituisce la precedente', async () => {
  const { workflow, store } = setup();
  const first = await workflow.receiveCommercialRequest(base);
  const second = await workflow.receiveCommercialRequest({
    ...base, message_id: '<m4@example.test>',
    request: { service: 'rental', asset: 'Ape' },
  });
  assert.equal(second.case_id, first.case_id);
  assert.equal(store.action(first.action_id).status, 'CANCELLED');
  assert.equal(store.action(second.action_id).status, 'PENDING_APPROVAL');
});

test('la risposta aggiorna la stessa lead e crea una sola bozza e progetto economico', async () => {
  const { workflow, store, calls } = setup();
  const first = await workflow.receiveCommercialRequest(base);
  const result = await workflow.receiveCommercialRequest(complete);
  assert.equal(result.case_id, first.case_id);
  assert.equal(result.ready_for_review, true);
  assert.equal(store.case(first.case_id).documents.quote.id, 'S00123');
  assert.equal(store.case(first.case_id).documents.project.task_name, '00 – RIEPILOGO ECONOMICO');
  assert.equal(calls.filter(([kind]) => kind === 'draft').length, 1);
  const repeated = await workflow.prepareDraft(first.case_id, 'repeat');
  assert.equal(repeated.duplicate, true);
  assert.equal(calls.filter(([kind]) => kind === 'draft').length, 1);
});

test('preventivo, follow-up e scadenza rispettano blocchi e condizioni', async () => {
  const { workflow, store } = setup();
  await workflow.receiveCommercialRequest(base);
  const ready = await workflow.receiveCommercialRequest(complete);
  workflow.recordQuoteSent(ready.case_id, '2026-09-01T10:00:00Z', '2026-09-15T22:00:00Z');
  const queued = workflow.queueDueFollowups(ready.case_id, new Date('2026-09-03T10:00:00Z'));
  assert.equal(queued.length, 1);
  store.updateCase(ready.case_id, { customer_responded: true });
  assert.equal(workflow.queueDueFollowups(ready.case_id, new Date('2026-09-20T10:00:00Z')).length, 0);
  assert.deepEqual(workflow.expireQuote(ready.case_id), { expired: false });
  assert.throws(() => workflow.setStage(ready.case_id, 'Nuove richieste'), /retrocedere/);
  assert.throws(() => workflow.setStage(ready.case_id, 'Stand-by'), /data certa/);
});

test('contratto, fatture multiple, pagamento parziale e sollecito mantengono il residuo', async () => {
  const { workflow, store } = setup();
  await workflow.receiveCommercialRequest(base);
  const ready = await workflow.receiveCommercialRequest(complete);
  const accepted = await workflow.acceptQuote(ready.case_id);
  assert.equal(accepted.contract.id, 'C1');
  assert.equal(accepted.action.status, 'PENDING_APPROVAL');
  const verified = { customer: true, vat: true, quote_id: true, amount: true, period: true, location: true, asset: true };
  await workflow.contractReturned(ready.case_id, { id: 'F1', number: '1/2026', total: 1000, due_at: '2026-09-20T00:00:00Z', verified });
  await workflow.contractReturned(ready.case_id, { id: 'F2', number: '2/2026', kind: 'saldo', total: 500, due_at: '2026-09-20T00:00:00Z', verified });
  const partial = workflow.recordPayment(ready.case_id, { account: 'IT00TEST', date: '2026-09-20', amount: 400, trn: 'TRN1', invoice_id: 'F1', certain_match: true });
  assert.equal(partial.invoice.residual, 600);
  assert.equal(store.case(ready.case_id).stage, 'Ricezione pagamento parziale');
  const reminder = workflow.queueOverdueReminder(ready.case_id, 'F1', new Date('2026-09-21T00:00:00Z'));
  assert.equal(reminder.status, 'PENDING_APPROVAL');
  assert.equal(reminder.payload.residual, 600);
  const duplicate = workflow.recordPayment(ready.case_id, { account: 'IT00TEST', date: '2026-09-20', amount: 400, trn: 'TRN1', invoice_id: 'F1', certain_match: true });
  assert.equal(duplicate.duplicate, true);
  const uncertain = workflow.recordPayment(ready.case_id, { account: 'IT00TEST', date: '2026-09-20', amount: 600, trn: 'TRN?', invoice_id: 'F1', certain_match: false });
  assert.equal(uncertain.recorded, false);
  assert.equal(uncertain.action.type, 'UNCERTAIN_BANK_MATCH');
});

test('consegna, rientro, cauzione e approvazione richiedono Pietro due volte', async () => {
  const { workflow, store, approvals } = setup();
  await workflow.receiveCommercialRequest(base);
  const ready = await workflow.receiveCommercialRequest(complete);
  const verified = { customer: true, vat: true, quote_id: true, amount: true, period: true, location: true, asset: true };
  await workflow.acceptQuote(ready.case_id);
  await workflow.contractReturned(ready.case_id, { id: 'F1', number: '1/2026', total: 1000, due_at: '2026-09-20T00:00:00Z', verified });
  workflow.recordPayment(ready.case_id, { account: 'IT00TEST', date: '2026-09-20', amount: 1000, trn: 'TRN2', invoice_id: 'F1', certain_match: true });
  assert.throws(() => workflow.confirmDelivery(ready.case_id, { at: '2026-09-10T09:00:00Z' }), /conferma/);
  workflow.confirmDelivery(ready.case_id, { at: '2026-09-10T09:00:00Z', confirmed_by_pietro: true });
  workflow.confirmReturn(ready.case_id, { at: '2026-09-11T18:00:00Z', confirmed_by_pietro: true, damages: [] });
  const deposit = workflow.closeOrQueueDeposit(ready.case_id);
  assert.equal(deposit.type, 'RETURN_DEPOSIT');
  assert.throws(() => approvals.assertExecutable(deposit.id), /servono comando specifico/);
  const command = approvals.approveCommand(deposit.id, 'Pietro', `APPROVA ${deposit.id}`);
  assert.equal(command.action.status, 'AWAITING_FINAL_CONFIRMATION');
  const confirmed = approvals.confirm(deposit.id, 'Pietro', command.confirmation_token);
  assert.equal(confirmed.status, 'APPROVED_FOR_EXECUTION');
  approvals.executed(deposit.id, { simulated: true });
  assert.equal(store.action(deposit.id).status, 'EXECUTED');
});
