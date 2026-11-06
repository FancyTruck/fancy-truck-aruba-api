// Keep the recent diagnostic window plus every unfinished cycle, in source
// order. Count/age alone is never evidence that RUNNING work completed.
// A backlog of unfinished cycles requires recovery, not silent deletion.
export function retainCycleHistory(cycles, limit) {
  const cutoff = Math.max(0, cycles.length - limit);
  return cycles.filter((cycle, index) => index >= cutoff || cycle?.status === 'RUNNING');
}
