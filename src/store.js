import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const EMPTY_STATE = {
  version: 1,
  idempotency: {},
  events: [],
  actions: {},
  cases: {},
  integrations: {},
  cycles: [],
  cursors: {},
  classification_reviews: {},
  mail_operations: {},
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class JsonStateStore {
  constructor(filePath = process.env.STATE_FILE || '/var/data/fancy-truck-state.json') {
    this.filePath = filePath;
    this.state = clone(EMPTY_STATE);
    this.load();
  }

  load() {
    try {
      this.state = { ...clone(EMPTY_STATE), ...JSON.parse(fs.readFileSync(this.filePath, 'utf8')) };
      this.compact();
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  compact() {
    if (this.state.events.length > 2000) {
      this.state.events = this.state.events.slice(-2000);
    }
    if (this.state.cycles.length > 200) {
      this.state.cycles = this.state.cycles.slice(-200);
    }
    const idempotencyEntries = Object.entries(this.state.idempotency);
    if (idempotencyEntries.length > 10000) {
      this.state.idempotency = Object.fromEntries(idempotencyEntries
        .sort(([, left], [, right]) => String(left?.at || '').localeCompare(String(right?.at || '')))
        .slice(-10000));
    }
  }

  save() {
    // Compaction uses replacement collections so an unsuccessful save cannot
    // silently discard previously durable replay keys or cycle history.
    const before = { events: this.state.events, cycles: this.state.cycles, idempotency: this.state.idempotency };
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      this.compact();
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.filePath);
    } catch (error) {
      Object.assign(this.state, before);
      try { fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  }

  has(key) {
    return Boolean(this.state.idempotency[key]);
  }

  remember(key, result = null) {
    if (this.has(key)) return this.state.idempotency[key];
    this.state.idempotency[key] = { at: new Date().toISOString(), result };
    try { this.save(); }
    catch (error) { delete this.state.idempotency[key]; throw error; }
    return this.state.idempotency[key];
  }

  cursor(name, fallback = null) {
    return this.state.cursors[name] ?? fallback;
  }

  setCursor(name, value) {
    const previous = this.state.cursors[name];
    this.state.cursors[name] = value;
    try { this.save(); }
    catch (error) {
      if (previous === undefined) delete this.state.cursors[name];
      else this.state.cursors[name] = previous;
      throw error;
    }
  }

  saveMailOperation(key, value) {
    const previous = this.state.mail_operations[key];
    this.state.mail_operations[key] = value;
    try { this.save(); }
    catch (error) {
      if (previous === undefined) delete this.state.mail_operations[key];
      else this.state.mail_operations[key] = previous;
      throw error;
    }
  }

  audit(type, payload = {}) {
    const row = { id: crypto.randomUUID(), at: new Date().toISOString(), type, ...payload };
    this.state.events.push(row);
    if (this.state.events.length > 10000) this.state.events.splice(0, this.state.events.length - 10000);
    this.save();
    return row;
  }

  integration(name, patch) {
    const previous = this.state.integrations[name];
    this.state.integrations[name] = {
      ...(this.state.integrations[name] || {}),
      ...patch,
      updated_at: new Date().toISOString(),
    };
    try { this.save(); }
    catch (error) {
      if (previous === undefined) delete this.state.integrations[name];
      else this.state.integrations[name] = previous;
      throw error;
    }
    return this.state.integrations[name];
  }

  beginCycle(sources) {
    const previous = this.state.cycles.slice();
    const cycle = {
      id: crypto.randomUUID(), started_at: new Date().toISOString(), ended_at: null,
      sources, read: 0, created: 0, updated: 0, duplicates: 0, suspended: 0, failed: 0,
      status: 'RUNNING', errors: [],
    };
    this.state.cycles.push(cycle);
    try { this.save(); }
    catch (error) { this.state.cycles = previous; throw error; }
    return cycle;
  }

  reconcileInterruptedCycles() {
    const pending = this.state.cycles.filter(cycle => cycle.status === 'RUNNING');
    if (!pending.length) return 0;
    const previous = clone(this.state);
    const at = new Date().toISOString();
    for (const cycle of pending) {
      cycle.status = 'INTERRUPTED';
      cycle.ended_at = at;
      cycle.errors = [...(cycle.errors || []), 'Processo riavviato prima della chiusura del ciclo'];
    }
    this.state.events.push({id: crypto.randomUUID(), at, type: 'CYCLES_INTERRUPTED_ON_STARTUP', cycle_ids: pending.map(cycle => cycle.id)});
    try { this.save(); }
    catch (error) { this.state = previous; throw error; }
    return pending.length;
  }

  finishCycle(id, patch = {}) {
    const cycle = this.state.cycles.find((item) => item.id === id);
    if (!cycle) throw new Error(`Ciclo ${id} non trovato`);
    const previous = clone(cycle);
    const previousCycles = this.state.cycles.slice();
    Object.assign(cycle, patch, { ended_at: new Date().toISOString() });
    if (!patch.status) cycle.status = cycle.failed ? 'CONTROLLO NON COMPLETATO' : 'COMPLETED';
    try { this.save(); }
    catch (error) {
      // Preserve references held by the owning server as well as the store.
      for (const key of Object.keys(cycle)) delete cycle[key];
      Object.assign(cycle, previous);
      this.state.cycles = previousCycles;
      throw error;
    }
    return cycle;
  }

  createAction(input) {
    const existing = Object.values(this.state.actions).find((item) => item.idempotency_key === input.idempotency_key);
    if (existing) return { action: existing, duplicate: true };
    const id = crypto.randomUUID();
    const action = {
      id,
      status: 'PENDING_APPROVAL',
      created_at: new Date().toISOString(),
      command_approved_at: null,
      final_confirmation_at: null,
      executed_at: null,
      ...input,
    };
    this.commitActionQueue(action, input.supersede_group, 'SUPERSEDED_BY_NEWER_ACTION');
    return { action, duplicate: false };
  }

  cancelActionGroup(group, reason = 'CANCELLED') {
    return this.commitActionQueue(null, group, reason);
  }

  // Draft queue mutations only: cancellation, replacement and audit are one
  // commit. Do not use this rollback to retry an external effect.
  commitActionQueue(newAction, group, reason) {
    const affected = group ? Object.values(this.state.actions).filter(action =>
      action.supersede_group === group && action.execution?.kind !== 'smtp' &&
      !['EXECUTED', 'CANCELLED'].includes(action.status)) : [];
    if (!newAction && !affected.length) return false;
    const previous = affected.map(action => [action, clone(action)]);
    const events = this.state.events, at = new Date().toISOString(), addedEvents = [];
    for (const action of affected) {
      Object.assign(action, { status: 'CANCELLED', cancelled_at: at, cancel_reason: reason });
      addedEvents.push({ id: crypto.randomUUID(), at, type: 'ACTION_CANCELLED',
        action_id: action.id, reason, supersede_group: group });
    }
    if (newAction) {
      this.state.actions[newAction.id] = newAction;
      addedEvents.push({ id: crypto.randomUUID(), at, type: 'ACTION_QUEUED',
        action_id: newAction.id, action_type: newAction.type, target: newAction.target });
    }
    this.state.events = [...events, ...addedEvents];
    try { this.save(); }
    catch (error) {
      if (newAction) delete this.state.actions[newAction.id];
      for (const [action, snapshot] of previous) {
        for (const key of Object.keys(action)) delete action[key];
        Object.assign(action, snapshot);
      }
      this.state.events = events;
      throw error;
    }
    return Boolean(affected.length);
  }

  action(id) {
    return this.state.actions[id] || null;
  }

  updateAction(id, patch) {
    const action = this.action(id);
    if (!action) throw new Error(`Azione ${id} non trovata`);
    Object.assign(action, patch);
    this.save();
    return action;
  }

  // Only the generic SMTP route uses this claim. Peu keeps its own effect ledger.
  beginSmtpExecution(id) {
    const action = this.action(id);
    if (!action || action.status !== 'APPROVED_FOR_EXECUTION' || action.execution || action.peu_payload_hash) {
      throw new Error('Invio bloccato: azione non approvata o tentativo già registrato');
    }
    const execution = {
      id: crypto.randomUUID(), kind: 'smtp', started_at: new Date().toISOString(),
      message_id: `<fancy-${action.id}@fancytruck.it>`,
      snapshot_hash: crypto.createHash('sha256').update(JSON.stringify({
        type: action.type, target: action.target, payload: action.payload,
      })).digest('hex'),
    };
    this.commitSmtpTransition(action, { status: 'EXECUTING', execution }, 'ACTION_SMTP_CLAIMED');
    return execution;
  }

  finishSmtpExecution(id, executionId, status, result) {
    const action = this.action(id);
    if (!action || action.status !== 'EXECUTING' || action.execution?.kind !== 'smtp' ||
      action.execution.id !== executionId || !['EXECUTED', 'UNCERTAIN'].includes(status)) {
      throw new Error('Esito SMTP non associabile al tentativo corrente');
    }
    const at = new Date().toISOString();
    return this.commitSmtpTransition(action, {
      status, execution: { ...action.execution, ended_at: at }, result,
      ...(status === 'EXECUTED' ? { executed_at: at } : {}),
    }, status === 'EXECUTED' ? 'ACTION_SMTP_ACCEPTED' : 'ACTION_SMTP_UNCERTAIN');
  }

  commitSmtpTransition(action, patch, type) {
    const previous = clone(action), events = this.state.events;
    Object.assign(action, patch);
    this.state.events = [...events, { id: crypto.randomUUID(), at: new Date().toISOString(),
      type, action_id: action.id, execution_id: action.execution.id }];
    try { this.save(); }
    catch (error) {
      // A failed settlement restores EXECUTING, never APPROVED_FOR_EXECUTION.
      for (const key of Object.keys(action)) delete action[key];
      Object.assign(action, previous);
      this.state.events = events;
      throw error;
    }
    return action;
  }

  reconcileInterruptedSmtpExecutions() {
    const pending = Object.values(this.state.actions).filter(action =>
      action.status === 'EXECUTING' && action.execution?.kind === 'smtp');
    if (!pending.length) return 0;
    const previous = pending.map(action => [action, clone(action)]), events = this.state.events;
    const at = new Date().toISOString();
    for (const action of pending) {
      action.status = 'UNCERTAIN';
      action.execution = { ...action.execution, interrupted_at: at };
      action.result = { status: 'outcome_unknown_reconcile_first', delivery_verified: false };
    }
    this.state.events = [...events, { id: crypto.randomUUID(), at,
      type: 'SMTP_EXECUTIONS_INTERRUPTED_ON_STARTUP', action_ids: pending.map(action => action.id) }];
    try { this.save(); }
    catch (error) {
      for (const [action, snapshot] of previous) {
        for (const key of Object.keys(action)) delete action[key];
        Object.assign(action, snapshot);
      }
      this.state.events = events;
      throw error;
    }
    return pending.length;
  }

  // Pre-execution authorization only. Persist the transition and its audit
  // together; never use this rollback to retry an uncertain external effect.
  commitApproval(id, patch, eventType) {
    const transitions = {
      ACTION_COMMAND_APPROVED: ['PENDING_APPROVAL', 'AWAITING_FINAL_CONFIRMATION'],
      ACTION_COMMAND_REISSUED: ['AWAITING_FINAL_CONFIRMATION', 'AWAITING_FINAL_CONFIRMATION'],
      ACTION_FINAL_CONFIRMED: ['AWAITING_FINAL_CONFIRMATION', 'APPROVED_FOR_EXECUTION'],
    };
    const action = this.action(id);
    const transition = transitions[eventType];
    if (!action || !transition || action.status !== transition[0] || patch.status !== transition[1]) {
      throw new Error('Transizione approvazione non valida');
    }
    const previous = clone(action);
    const events = this.state.events;
    Object.assign(action, patch);
    this.state.events = [...events, { id: crypto.randomUUID(), at: new Date().toISOString(),
      type: eventType, action_id: id, actor: 'Pietro' }];
    try { this.save(); }
    catch (error) {
      for (const key of Object.keys(action)) delete action[key];
      Object.assign(action, previous);
      this.state.events = events;
      throw error;
    }
    return action;
  }

  case(id) {
    return this.state.cases[id] || null;
  }

  findCase(predicate) {
    return Object.values(this.state.cases).find(predicate) || null;
  }

  createCase(input) {
    const id = input.id || crypto.randomUUID();
    if (this.state.cases[id]) return { item: this.state.cases[id], duplicate: true };
    const item = { id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...input };
    this.state.cases[id] = item;
    this.audit('CASE_CREATED', { case_id: id, stage: item.stage });
    return { item, duplicate: false };
  }

  updateCase(id, patch) {
    const item = this.case(id);
    if (!item) throw new Error(`Pratica ${id} non trovata`);
    Object.assign(item, patch, { updated_at: new Date().toISOString() });
    this.save();
    return item;
  }

  snapshot() {
    return clone(this.state);
  }

  queueClassification(input) {
    const id = crypto.createHash('sha256').update(input.source_key).digest('hex');
    const existing = this.state.classification_reviews[id];
    if (existing) return { item: existing, duplicate: true };
    const item = { ...input, id, status: 'DA_CLASSIFICARE', created_at: new Date().toISOString() };
    this.state.classification_reviews[id] = item;
    try { this.save(); }
    catch (error) {
      delete this.state.classification_reviews[id];
      throw error;
    }
    return { item, duplicate: false };
  }

  resolveClassification(id, resolution, note, actor) {
    const previous = this.state.classification_reviews[id];
    if (!previous || previous.status !== 'DA_CLASSIFICARE') throw new Error('Revisione non disponibile o già chiusa');
    if (!['HANDLED_MANUALLY', 'NOT_COMMERCIAL'].includes(resolution)) throw new Error('Esito non valido');
    if (previous.operation_id && resolution !== 'HANDLED_MANUALLY') throw new Error('Verificare prima l’operazione in Odoo');
    if (typeof note !== 'string' || note.trim().length < 10 || note.length > 2000) throw new Error('Descrivere il controllo eseguito (10–2000 caratteri)');
    const item = { ...previous, status: 'RESOLVED', resolution, resolution_note: note.trim(),
      resolved_at: new Date().toISOString(), resolved_by_role: actor };
    const operation = previous.operation_id ? this.state.mail_operations[previous.operation_id] : null;
    if (previous.operation_id && (!operation || operation.status !== 'STARTED')) throw new Error('Registro operazione incoerente: verificare prima della chiusura');
    if (operation) this.state.mail_operations[previous.operation_id] = {
      ...operation, status: 'COMPLETED', completed_at: item.resolved_at,
      result: { handled_manually: true, review_id: id },
      reconciliation: { note: item.resolution_note, actor, review_id: id },
    };
    this.state.classification_reviews[id] = item;
    try { this.save(); } catch (error) {
      this.state.classification_reviews[id] = previous;
      if (operation) this.state.mail_operations[previous.operation_id] = operation;
      throw error;
    }
    return item;
  }
}
