import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Shell from '../components/Shell.jsx'
import { listRuns } from '../api.js'
import { runDuration } from '../format.js'

export default function Dashboard() {
  const [runs, setRuns] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { listRuns().then(setRuns).catch(e => setErr(String(e.message || e))) }, [])

  // tick once a second only while something is running, so live durations count up
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!(runs || []).some(r => r.status === 'running')) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [runs])

  const repos = (runs || []).reduce((n, r) => n + (r.done_count || 0), 0)
  const sig = (runs || []).reduce((n, r) => n + (r.significant_count || 0), 0)
  const flaggedN = (runs || []).reduce((n, r) => n + (r.flagged_count || 0), 0)

  return (
    <Shell title="Dashboard" headRight={<Link className="btn sm" to="/runs/new">+ New run</Link>}>
      <div className="stats">
        {[[(runs || []).length, 'runs'], [repos, 'repos verified'], [sig, 'Significant'], [flaggedN, 'flagged', true]]
          .map(([n, l, flag]) => (
            <div key={l} className={`glass stat${flag ? ' flag' : ''}`}>
              <div className="n">{runs ? n : '…'}</div><div className="l">{l}</div>
            </div>
          ))}
      </div>

      <div className="glass" style={{ padding: '4px 0' }}>
        <div style={{ padding: '12px 16px', fontWeight: 700 }}>Recent runs</div>
        {err && <p className="dqline" style={{ margin: '0 16px 14px' }}>Couldn't reach the API: {err}</p>}
        {runs && runs.length === 0 ? (
          <div style={{ padding: '10px 16px 26px', textAlign: 'center' }}>
            <img className="astro" src="/astronaut.svg" alt="" style={{ height: 44 }} />
            <p className="muted" style={{ fontSize: 13.5 }}>
              No runs yet. Start your first verification - upload a submissions sheet or paste repo URLs.
            </p>
            <Link className="btn sm" to="/runs/new">Start a run →</Link>
          </div>
        ) : (
          <div className="scrolltable">
          <table className="list">
            <thead><tr><th>Run</th><th>Event date</th><th>Repos</th><th>Duration</th><th>Status</th></tr></thead>
            <tbody>
              {(runs || []).map(r => (
                <tr key={r.id}>
                  <td><Link to={`/runs/${r.id}`}><b>{r.name}</b></Link></td>
                  <td>{r.event_date || '-'}</td>
                  <td>{r.done_count}{r.total ? ` / ${r.total}` : ''}</td>
                  <td className="muted">{runDuration(r, now) ? `${runDuration(r, now)}${r.status === 'running' ? '…' : ''}` : '-'}</td>
                  <td><span className={`pill ${r.status === 'done' ? 'done' : r.status === 'stopped' ? 'draft' : 'running'}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </Shell>
  )
}
