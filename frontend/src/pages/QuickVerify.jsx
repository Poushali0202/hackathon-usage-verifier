import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Shell from '../components/Shell.jsx'
import ResultsGrid from '../components/ResultsGrid.jsx'
import { AllowanceWarning } from '../components/bits.jsx'
import { listTargets, runLive } from '../api.js'
import { getPlan, getSettings } from '../store.js'

// Ad-hoc verification - the fast path for spot-checking a repo (or a few) without a
// submissions sheet. Batch (whole event via spreadsheet) lives in the New run wizard.
export default function QuickVerify() {
  const defaults = getSettings()
  const isCompany = getPlan() === 'company'
  const [urls, setUrls] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [penalty, setPenalty] = useState(defaults.history_penalty ?? 2)
  const [targets, setTargets] = useState([])
  const [targetId, setTargetId] = useState('')
  const [run, setRun] = useState(null)
  const runRef = useRef(null)

  useEffect(() => {
    listTargets().then(ts => { setTargets(ts); if (ts[0]) setTargetId(ts[0].id) }).catch(() => {})
  }, [])

  const repos = urls.split(/\s+/).filter(u => u.includes('github.com'))
  const valid = repos.length > 0 && eventDate && run?.status !== 'running'

  async function verify() {
    const repoName = repos[0].replace(/\/+$/, '').split('/').slice(-1)[0] || 'repo'
    const runName = repos.length === 1
      ? `Quick verify - ${repoName}` : `Quick verify - ${repos.length} repos`
    const base = { status: 'running', results: [], total: repos.length, stage: '' }
    runRef.current = base
    setRun({ ...base })
    const onEvent = (ev) => {
      const r = runRef.current
      if (ev.event === 'start') r.allowance = ev.allowance
      else if (ev.event === 'result') r.results = [...r.results, ev.result]
      else if (ev.event === 'stage') r.stage = `#${ev.index} ${ev.stage || ev.message || ''}`
      else if (ev.event === 'done') { r.status = 'done'; r.summary = ev.summary }
      setRun({ ...r })
    }
    try {
      await runLive({
        repos: repos.map(u => ({ project: '', github: u, feedback: '', demo: '', deployed: '' })),
        eventDate, historyPenalty: penalty, runName, targetId,
      }, onEvent)
      const r = runRef.current
      if (r.status !== 'done') { r.status = 'done'; setRun({ ...r }) }
    } catch (e) {
      const r = runRef.current
      r.status = 'error'; r.error = String(e.message || e)
      setRun({ ...r })
    }
  }

  return (
    <Shell title="Quick verify" wide>
      <p className="muted" style={{ margin: '-8px 0 18px', fontSize: 13 }}>
        Spot-check a repository (or a few) and get the full evidence dossier for each.
        Judging a whole event? Use <Link to="/runs/new">New run</Link> with your
        submissions sheet.
      </p>

      <div className="glass" style={{ padding: 24, maxWidth: 680 }}>
        <div className="field">
          <label>GitHub repository URL(s) <span className="muted">(one per line)</span></label>
          <textarea rows={3} placeholder={'https://github.com/team/project\nhttps://github.com/...'}
                    value={urls} onChange={e => setUrls(e.target.value)} />
          {repos.length > 1 && <div className="help">{repos.length} repositories detected.</div>}
        </div>
        <div className="inline">
          <div className="field">
            <label>Target</label>
            <select value={targetId} onChange={e => setTargetId(e.target.value)}>
              {targets.map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.is_preset ? ' (preset)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Event date (required)</label>
            <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Pre-event penalty (pts) {!isCompany && '🔒'}</label>
            <input type="number" min="0" step="0.5" value={penalty} disabled={!isCompany}
                   onChange={e => setPenalty(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" disabled={!valid} onClick={verify}>
            {run?.status === 'running' ? 'Verifying…'
              : repos.length > 1 ? `Verify ${repos.length} repositories ▶` : 'Verify repository ▶'}
          </button>
          {run?.status === 'running' && (
            <span className="stageline" style={{ flex: 1 }}>
              <img className="astro" src="/astronaut.svg" alt="" /> {run.stage}
            </span>
          )}
        </div>
      </div>

      {run?.status === 'error' && (
        <div className="dqline" style={{ marginTop: 16 }}>Verification failed: {run.error}</div>
      )}
      {run?.results?.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <AllowanceWarning a={run.allowance} />
          <ResultsGrid results={run.results} total={run.total} summary={run.summary}
                       exportName="quick-verify.xlsx" />
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Saved to <Link to="/runs">Runs</Link> like any verification, so the dossier stays
            on record.
          </p>
        </div>
      )}
    </Shell>
  )
}
