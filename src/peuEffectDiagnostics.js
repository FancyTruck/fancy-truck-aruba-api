// Administrative projection only: no identifiers, result bodies, writes or retry.
// A request ledger entry is not proof that an external effect occurred.
export function peuEffectDiagnostics(db) {
  if (!db) return {status:'NOT_AVAILABLE', effects:null, requests:null};
  try {
    // One SQLite statement gives a consistent snapshot across both ledgers.
    const row = db.prepare(`SELECT
      (SELECT count(*) FROM peu_effects WHERE status='executing') AS effect_executing,
      (SELECT count(*) FROM peu_effects WHERE status='unknown') AS effect_unknown,
      (SELECT count(*) FROM peu_operations WHERE status='executing') AS request_executing,
      (SELECT count(*) FROM peu_operations WHERE status='unknown') AS request_unknown`).get();
    const effects={executing:row.effect_executing, unknown:row.effect_unknown};
    const requests={executing:row.request_executing, unknown:row.request_unknown};
    return {status:effects.unknown||requests.unknown?'REVIEW_REQUIRED':
      effects.executing||requests.executing?'IN_PROGRESS':'NO_UNRESOLVED_ENTRIES', effects, requests};
  } catch {
    // Older readonly snapshots may lack tables; do not create or repair them.
    return {status:'UNAVAILABLE', effects:null, requests:null};
  }
}
