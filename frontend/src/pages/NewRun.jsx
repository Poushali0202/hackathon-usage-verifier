import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell.jsx'
import ResultsGrid from '../components/ResultsGrid.jsx'
import { TierLockModal } from '../components/bits.jsx'
import LiveHint from '../components/LiveHint.jsx'
import { listTargets, runBatch } from '../api.js'
import { getPlan, getSettings } from '../store.js'

const STEPS = ['Event', 'Target', 'Submissions']

function Stepper({ step }) {
  return (
    <div className="steps">
      {STEPS.map((s, i) => (
        <span key={s} style={{ display: 'contents' }}>
          {i > 0 && <span className="bar" />}
          <span className={`step ${i === step ? 'cur' : ''}`}>
            <span className="dotn">{i + 1}</span> {s}
          </span>
        </span>
      ))}
    </div>
  )
}

export default function NewRun() {
  const nav = useNavigate()
  const defaults = getSettings()
  const isCompany = getPlan() === 'company'
  const [step, setStep] = useState(0)
  const [lockOpen, setLockOpen] = useState(false)

  // step 1 - event
  const [name, setName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [penalty, setPenalty] = useState(defaults.history_penalty ?? 2)

  // step 2 - target (from the server, per-org)
  const [targets, setTargets] = useState([])
  const [targetId, setTargetId] = useState('')
  useEffect(() => {
    listTargets().then(ts => { setTargets(ts); if (ts[0]) setTargetId(ts[0].id) }).catch(() => {})
  }, [])

  // step 3 - submissions (batch = sheet upload; single repos live in Quick verify)
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const fileInput = useRef(null)

  // run state
  const [run, setRun] = useState(null)          // {id, results, total, summary, status, error}
  const runRef = useRef(null)
  const abortRef = useRef(null)                 // aborting the stream marks the run 'stopped' server-side

  const canRun = eventDate && !!file

  async function start() {
    const runName = name || `Run ${new Date().toLocaleDateString()}`
    const base = {
      id: null, name: runName, eventDate, historyPenalty: penalty,
      status: 'running', results: [], total: null, summary: null,
    }
    runRef.current = base
    setRun({ ...base })
    const onEvent = (ev) => {
      const r = runRef.current
      if (ev.event === 'start') { r.total = ev.total; r.id = ev.run_id || r.id }
      else if (ev.event === 'result') r.results = [...r.results, ev.result]
      else if (ev.event === 'stage') r.stage = `#${ev.index} ${ev.stage || ev.message || ''}`
      else if (ev.event === 'done') { r.status = 'done'; r.summary = ev.summary }
      else if (ev.event === 'stopped') { r.status = 'stopped'; r.summary = ev.summary }
      setRun({ ...r })
    }
    try {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      const opts = { eventDate, historyPenalty: penalty, runName, targetId, signal: ctrl.signal }
      await runBatch({ file, ...opts }, onEvent)
      const r = runRef.current
      if (r.status !== 'done' && r.status !== 'stopped') { r.status = 'done'; setRun({ ...r }) }
    } catch (e) {
      const r = runRef.current
      if (e.name === 'AbortError') {
        r.status = 'stopped'             // partial results kept; the server marks the run stopped too
      } else {
        r.status = 'error'; r.error = String(e.message || e)
      }
      setRun({ ...r })
    }
  }

  // ---------- live view (after Run verification) ----------
  if (run) {
    const pct = run.total ? Math.round((run.results.length / run.total) * 100) : 0
    return (
      <Shell title={run.name} wide
             headRight={<span className={`pill ${run.status === 'done' ? 'done' : run.status === 'running' ? 'running' : 'draft'}`}>{run.status}</span>}>
        {run.status === 'running' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, maxWidth: 680, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <div className="runbar"><i style={{ width: `${pct}%` }} /></div>
              <div className="stageline">
                <img className="astro" src="/astronaut.svg" alt="" /> verifying… {run.stage || ''}
              </div>
            </div>
            <button className="btn ghost sm" onClick={() => abortRef.current?.abort()}>■ Stop run</button>
          </div>
        )}
        {run.status === 'stopped' && (
          <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
            Run stopped - {run.results.length}{run.total ? ` of ${run.total}` : ''} verified before the
            stop; results below are kept (also saved to the run page).
          </p>
        )}
        {run.status === 'error' && (
          <div className="dqline">Run failed: {run.error}. Is the API up? (uvicorn app.main:app - or set VITE_API_TARGET)</div>
        )}
        <ResultsGrid results={run.results} total={run.total} summary={run.summary}
                     exportName={`${run.name.replace(/\s+/g, '_')}.xlsx`} />
        {run.status !== 'running' && (
          <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <button className="btn ghost sm" disabled={!run.id}
                    onClick={() => nav(`/runs/${run.id}`)}>Open run page</button>
            <button className="btn sm" onClick={() => { setRun(null); setStep(0); setFile(null); setPasted('') }}>New run</button>
          </div>
        )}
      </Shell>
    )
  }

  // ---------- wizard ----------
  return (
    <Shell title="New run">
      <Stepper step={step} />
      <div className="glass" style={{ padding: 24, maxWidth: 640 }}>
        {step === 0 && (
          <>
            <div className="field">
              <label>Event name</label>
              <input type="text" placeholder="e.g. Frontier SF Hackathon" value={name}
                     onChange={e => setName(e.target.value)} />
            </div>
            <div className="inline">
              <div className="field">
                <label>Event date (required)</label>
                <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
                <div className="help">Commit-history checks measure against this date ± {defaults.grace_days ?? 2} grace days.</div>
              </div>
              <div className="field">
                <label>Pre-event work penalty (pts) {!isCompany && '🔒'}</label>
                <input type="number" min="0" step="0.5" value={penalty} disabled={!isCompany}
                       onChange={e => setPenalty(e.target.value)} />
                <div className="help">{isCompany
                  ? 'Deducted when a project\'s history predates the event window. 0 = flag only.'
                  : 'The Company plan controls how hard pre-event work is penalized.'}</div>
              </div>
            </div>
            <div className="lockcard">
              <h3>🔒 COMPANY - Git freshness &amp; integrity checks</h3>
              <p>Flag projects built before your event, detect commit-date rewrites, and set the
                 penalty judges apply. {isCompany ? <b>Enabled on your plan.</b> : <b>Locked on Developer.</b>}</p>
              <button className="btn gold sm" onClick={() => setLockOpen(true)}>
                {isCompany ? 'About Company →' : 'Unlock with Company →'}</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="field">
              <label>Target</label>
              <select value={targetId} onChange={e => setTargetId(e.target.value)}>
                {targets.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_preset ? ' (preset)' : ''}</option>
                ))}
              </select>
              <div className="help">Your org's saved targets - every check (dependency, invocation,
                API usage, deploy evidence) runs against the one you pick.</div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="field">
              <label>Submissions sheet (CSV / XLSX)</label>
              <div className={`dropzone ${drag ? 'drag' : ''}`}
                   onClick={() => fileInput.current?.click()}
                   onDragOver={e => { e.preventDefault(); setDrag(true) }}
                   onDragLeave={() => setDrag(false)}
                   onDrop={e => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files[0] || null) }}>
                <b>Drop your submissions sheet here</b> or click to browse.<br />
                <span style={{ fontSize: 12.5 }}>Odd column layouts are fine - the sheet brain maps them.</span>
                {file && <div><span className="filechip">📄 {file.name}</span></div>}
              </div>
              <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls" hidden
                     onChange={e => setFile(e.target.files[0] || null)} />
              <div className="altpath">
                <span className="altico">⚡</span>
                <span><b>No sheet?</b> Verify a repo or a few directly, no event setup needed.</span>
                <Link className="btn ghost sm" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
                      to="/verify">Open Quick verify →</Link>
              </div>
            </div>
            <LiveHint />
          </>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          {step > 0 && <button className="btn ghost sm" onClick={() => setStep(step - 1)}>← Back</button>}
          {step < 2 && <button className="btn sm" disabled={step === 0 && !eventDate}
                               onClick={() => setStep(step + 1)}>Continue →</button>}
          {step === 2 && <button className="btn sm" disabled={!canRun} onClick={start}>Run verification ▶</button>}
        </div>
        {step === 0 && !eventDate && <p className="help" style={{ textAlign: 'right' }}>Pick the event date to continue.</p>}
      </div>

      <TierLockModal open={lockOpen} onClose={() => setLockOpen(false)} title="Git freshness & integrity is a Company feature">
        <p>Pro verifies every project was built at your event: earliest-commit checks against the
          event window, commit-date tamper detection, and a judge-set penalty. It's enabled in this
          preview so you can evaluate it.</p>
      </TierLockModal>
    </Shell>
  )
}
