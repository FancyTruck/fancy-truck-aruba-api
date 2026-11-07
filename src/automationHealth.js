// A live process and a fresh cycle are not proof of successful automation.
// This pure projection never runs work or changes persistent state.
export function automationHealth({ runtime, cycles, operatingNow, startedAt, now = Date.now() }) {
  const lastCycle = cycles.at(-1) || null;
  const reasons = [];
  // Retained unfinished work may predate the latest completed diagnostic row.
  const running = cycles.filter(cycle => cycle.status === 'RUNNING');
  const stalled = running.filter(cycle => {
    const started = Date.parse(cycle.started_at);
    return !Number.isFinite(started) || now - started > 2 * 60 * 60 * 1000;
  });
  let stale = stalled.length > 0;
  if (stale) reasons.push('CYCLE_STALLED');
  if (lastCycle) {
    if (lastCycle.status !== 'RUNNING') {
      const ended = Date.parse(lastCycle.ended_at);
      const lastStale = !Number.isFinite(ended) || (operatingNow && now - ended > 2 * 60 * 60 * 1000);
      stale ||= lastStale;
      if (lastStale) reasons.push('CYCLE_STALE');
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
      : running.length ? 'RUNNING' : lastCycle ? 'OK' : 'NOT_YET_VERIFIED',
    stale, reasons, lastCycle, running_cycles: running.length, stalled_cycles: stalled.length,
  };
}
