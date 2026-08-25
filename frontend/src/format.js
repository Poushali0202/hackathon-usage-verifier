// Wall-clock duration of a whole run: finished_at - created_at once the run is
// over, elapsed-so-far while it is still running. Returns null when the row
// predates duration tracking (old runs have no finished_at).
export function runDuration(r, now = Date.now()) {
  if (!r?.created_at) return null
  const start = new Date(r.created_at).getTime()
  const end = r.finished_at
    ? new Date(r.finished_at).getTime()
    : (r.status === 'running' ? now : null)
  if (end == null || !Number.isFinite(start) || end < start) return null
  const s = Math.round((end - start) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
