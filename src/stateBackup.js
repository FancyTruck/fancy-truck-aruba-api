import fs from 'node:fs';
import crypto from 'node:crypto';
export function validateState(state) {
  if (!state || state.version !== 1 || typeof state !== 'object') throw new Error('Versione stato non valida');
  for (const key of ['idempotency','actions','cases','integrations','cursors','classification_reviews','mail_operations']) {
    if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) throw new Error(`Stato non valido: ${key}`);
  }
  for (const key of ['events','cycles']) if (!Array.isArray(state[key])) throw new Error(`Stato non valido: ${key}`);
  return state;
}
export function backupState(store, destination) {
  const payload = JSON.stringify(validateState(store.snapshot()));
  const envelope = { format: 1, created_at: new Date().toISOString(),
    sha256: crypto.createHash('sha256').update(payload).digest('hex'), payload };
  fs.writeFileSync(destination, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
}
export function restoreState(backup, destination) {
  const envelope = JSON.parse(fs.readFileSync(backup, 'utf8'));
  if (envelope.format !== 1 || typeof envelope.payload !== 'string' ||
    crypto.createHash('sha256').update(envelope.payload).digest('hex') !== envelope.sha256) throw new Error('Integrità backup non valida');
  const state = validateState(JSON.parse(envelope.payload));
  // Restore to a NEW path only; never overwrite a running production state.
  fs.writeFileSync(destination, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  return state;
}
