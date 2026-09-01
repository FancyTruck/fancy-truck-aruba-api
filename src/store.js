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
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  save() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  has(key) {
    return Boolean(this.state.idempotency[key]);
  }

  remember(key, result = null) {
    if (this.has(key)) return this.state.idempotency[key];
    this.state.idempotency[key] = { at: new Date().toISOString(), result };
    this.save();
    return this.state.idempotency[key];
  }

  cursor(name, fallback = null) {
    return this.state.cursors[name] ?? fallback;
  }

  setCursor(name, value) {
    this.state.cursors[name] = value;
    this.save();
  }

  audit(type, payload = {}) {
    const row = { id: crypto.randomUUID(), at: new Date().toISOString(), type, ...payload };
    this.state.events.push(row);
    if (this.state.events.length > 10000) this.state.events.splice(0, this.state.events.length - 10000);
    this.save();
    return row;
  }

  integration(name, patch) {
    this.state.integrations[name] = {
      ...(this.state.integrations[name] || {}),
      ...patch,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.state.integrations[name];
  }

  beginCycle(sources) {
    const cycle = {
      id: crypto.randomUUID(), started_at: new Date().toISOString(), ended_at: null,
      sources, read: 0, created: 0, updated: 0, duplicates: 0, suspended: 0, failed: 0,
      status: 'RUNNING', errors: [],
    };
    this.state.cycles.push(cycle);
    this.save();
    return cycle;
  }

  finishCycle(id, patch = {}) {
    const cycle = this.state.cycles.find((item) => item.id === id);
    if (!cycle) throw new Error(`Ciclo ${id} non trovato`);
    Object.assign(cycle, patch, { ended_at: new Date().toISOString() });
    if (!patch.status) cycle.status = cycle.failed ? 'CONTROLLO NON COMPLETATO' : 'COMPLETED';
    if (this.state.cycles.length > 1000) this.state.cycles.splice(0, this.state.cycles.length - 1000);
    this.save();
    return cycle;
  }

  createAction(input) {
    const existing = Object.values(this.state.actions).find((item) => item.idempotency_key === input.idempotency_key);
    if (existing) return { action: existing, duplicate: true };
    if (input.supersede_group) this.cancelActionGroup(input.supersede_group, 'SUPERSEDED_BY_NEWER_ACTION');
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
    this.state.actions[id] = action;
    this.audit('ACTION_QUEUED', { action_id: id, action_type: action.type, target: action.target });
    return { action, duplicate: false };
  }

  cancelActionGroup(group, reason = 'CANCELLED') {
    let changed = false;
    for (const action of Object.values(this.state.actions)) {
      if (action.supersede_group !== group || ['EXECUTED', 'CANCELLED'].includes(action.status)) continue;
      action.status = 'CANCELLED';
      action.cancelled_at = new Date().toISOString();
      action.cancel_reason = reason;
      this.audit('ACTION_CANCELLED', { action_id: action.id, reason, supersede_group: group });
      changed = true;
    }
    if (changed) this.save();
    return changed;
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
}
