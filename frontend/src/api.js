// Thin client over the existing Phase-1 FastAPI. Both run endpoints stream NDJSON:
//   {event:"start", total}  →  {event:"stage"|"result", index, ...}  →  {event:"done", summary}
const BASE = import.meta.env.VITE_API_BASE || ''   // '' = same origin / vite dev proxy

// Dev identity header - mirrors the O-Connect stub session. The backend's AUTH_MODE=dev
// maps it to a tenant; when real O-Connect lands this becomes an Authorization header.
function authHeaders() {
  try {
    const u = JSON.parse(localStorage.getItem('hj_user'))
    return { 'X-Dev-User': (u?.name || 'poushali').toLowerCase() }
  } catch { return { 'X-Dev-User': 'poushali' } }
}

async function j(path, opts = {}) {
  const resp = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
  })
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text().catch(() => resp.statusText)}`)
  return resp.json()
}

// ---- persisted entities (M2) ----
// credentials live in RocketRide's encrypted environment keystore - presence only, no read-back
export const getCredentials = () => j('/api/credentials')
export const saveCredentials = (updates) => j('/api/credentials', { method: 'POST', body: JSON.stringify({ updates }) })

export const listTargets = () => j('/api/targets')
export const createTarget = (name, config) => j('/api/targets', { method: 'POST', body: JSON.stringify({ name, config }) })
export const updateTarget = (id, name, config) => j(`/api/targets/${id}`, { method: 'PUT', body: JSON.stringify({ name, config }) })
export const deleteTarget = (id) => j(`/api/targets/${id}`, { method: 'DELETE' })
export const listRuns = () => j('/api/runs')
export const getRun = (id) => j(`/api/runs/${id}`)
export const stopRun = (id) => j(`/api/runs/${id}/stop`, { method: 'POST' })
export async function extractTarget({ githubUrl, docsUrl, pkg, files }) {
  const fd = new FormData()
  if (githubUrl) fd.append('github_url', githubUrl)
  if (docsUrl) fd.append('docs_url', docsUrl)
  if (pkg) fd.append('package', pkg)
  for (const f of files || []) fd.append('files', f)
  const resp = await fetch(`${BASE}/api/targets/extract`, { method: 'POST', body: fd, headers: authHeaders() })
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text().catch(() => resp.statusText)}`)
  return resp.json()
}
export const testTarget = (repoUrl, name, config, engine = 'local') =>
  j('/api/targets/test', { method: 'POST', body: JSON.stringify({ repo_url: repoUrl, name, config, engine }) })

async function streamNdjson(resp, onEvent) {
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text().catch(() => resp.statusText)}`)
  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) onEvent(JSON.parse(line))
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf.trim()))
}

// sheet upload (CSV/XLSX) - the backend's deterministic column detection + LLM sheet brain
export async function runBatch({ file, eventDate, historyPenalty, runName, targetId, signal }, onEvent) {
  const fd = new FormData()
  fd.append('file', file)
  if (eventDate) fd.append('event_date', eventDate)
  if (historyPenalty !== '' && historyPenalty != null) fd.append('history_penalty', historyPenalty)
  if (runName) fd.append('run_name', runName)
  if (targetId) fd.append('target_id', targetId)
  const resp = await fetch(`${BASE}/api/batch`, { method: 'POST', body: fd, headers: authHeaders(), signal })
  await streamNdjson(resp, onEvent)
}

// pasted GitHub URLs
export async function runLive({ repos, eventDate, historyPenalty, runName, targetId, signal }, onEvent) {
  const body = {
    repos,
    event_date: eventDate || null,
    history_penalty: historyPenalty === '' || historyPenalty == null ? null : Number(historyPenalty),
    run_name: runName || null,
    target_id: targetId || null,
  }
  const resp = await fetch(`${BASE}/api/verify/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  })
  await streamNdjson(resp, onEvent)
}

// styled Excel, built server-side from the results the browser holds (stateless)
export async function exportExcel(results, filename = 'hack-judge-results.xlsx') {
  const resp = await fetch(`${BASE}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  })
  if (!resp.ok) throw new Error(`export failed: ${resp.status}`)
  const blob = await resp.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export const health = () => fetch(`${BASE}/api/health`).then(r => r.json())
