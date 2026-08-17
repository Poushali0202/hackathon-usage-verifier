import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Shell from '../components/Shell.jsx'
import ResultsGrid from '../components/ResultsGrid.jsx'
import { getRun, stopRun } from '../api.js'

export default function RunResults() {
  const { id } = useParams()
  const [run, setRun] = useState(null)
  const [err, setErr] = useState(null)
  const [stopping, setStopping] = useState(false)

  useEffect(() => { getRun(id).then(setRun).catch(e => setErr(String(e.message || e))) }, [id])

  // a running run refreshes itself every 5s, so this page is a live view for any tab
  useEffect(() => {
    if (run?.status !== 'running') return
    const t = setInterval(() => getRun(id).then(setRun).catch(() => {}), 5000)
    return () => clearInterval(t)
  }, [id, run?.status])

  async function onStop() {
    setStopping(true)
    try { await stopRun(id); setRun(await getRun(id)) } catch (e) { setErr(String(e.message || e)) }
    setStopping(false)
  }

  if (err) {
    return (
      <Shell title="Run not found">
        <p className="dqline">{err}</p>
        <p className="muted"><Link to="/runs/new">Start a new run →</Link></p>
      </Shell>
    )
  }
  if (!run) return <Shell title="Loading…"><p className="muted">Fetching run…</p></Shell>

  return (
    <Shell title={run.name} wide
           headRight={
             <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
               {run.status === 'running' &&
                 <button className="btn ghost sm" disabled={stopping} onClick={onStop}>
                   {stopping ? 'Stopping…' : '■ Stop run'}</button>}
               <span className={`pill ${run.status === 'done' ? 'done' : run.status === 'stopped' ? 'draft' : 'running'}`}>{run.status}</span>
             </span>
           }>
      <p className="muted" style={{ margin: '-8px 0 14px', fontSize: 13 }}>
        Target <b>{run.target_name || 'RocketRide'}</b> · event date {run.event_date || '-'} ·
        pre-event work penalty −{run.history_penalty ?? 2} pts
        {run.status === 'running' && ' · refreshing live'}
        {run.status === 'stopped' && ' · this run was stopped; results below are what completed'}
      </p>
      <ResultsGrid results={run.results || []} total={run.total} summary={run.summary}
                   exportName={`${run.name.replace(/\s+/g, '_')}.xlsx`} />
    </Shell>
  )
}
