// A live process and a fresh cycle are not proof of successful automation.
// This pure projection never runs work or changes persistent state.
export function automationHealth({ runtime, cycles, operatingNow, startedAt, now = Date.now() }) {
  const lastCycle = cycles.at(-1) || null;
  const reasons = [];
  let stale = false;
  if (lastCycle) {
    if (lastCycle.status === 'RUNNING') {
      const started = Date.parse(lastCycle.started_at);
      stale = !Number.isFinite(started) || now - started > 2 * 60 * 60 * 1000;
      if (stale) reasons.push('CYCLE_STALLED');
    } else {
      const ended = Date.parse(lastCycle.ended_at);
      stale = !Number.isFinite(ended) || (operatingNow && now - ended > 2 * 60 * 60 * 1000);
      if (stale) reasons.push('CYCLE_STALE');
      if (lastCycle.status !== 'COMPLETED' || lastCycle.failed > 0 || lastCycle.suspended > 0) {
        reasons.push('LAST_CYCLE_INCOMPLETE');
      }
    }
  } else if (operatingNow && now - startedAt > 10 * 60 * 1000) {
    stale = true;
    reasons.push('NO_COMPLETED_CYCLE');
  }
  const disabled = runtime.readOnly || !runtime.automationEnabled;
  return {
    status: disabled ? 'DISABLED' : reasons.length ? 'DEGRADED'
      : lastCycle?.status === 'RUNNING' ? 'RUNNING' : lastCycle ? 'OK' : 'NOT_YET_VERIFIED',
    stale, reasons, lastCycle,
  };
}
