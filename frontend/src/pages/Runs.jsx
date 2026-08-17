import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Shell from '../components/Shell.jsx'
import { listRuns } from '../api.js'

export default function Runs() {
  const [runs, setRuns] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { listRuns().then(setRuns).catch(e => setErr(String(e.message || e))) }, [])

  return (
    <Shell title="Runs" headRight={<Link className="btn sm" to="/runs/new">+ New run</Link>}>
      <div className="glass" style={{ padding: '4px 0' }}>
        {err && <p className="dqline" style={{ margin: '14px 16px' }}>Couldn't reach the API: {err}</p>}
        {runs && runs.length === 0 ? (
          <p className="muted" style={{ padding: '18px 16px' }}>No runs yet.</p>
        ) : (
          <table className="list">
            <thead><tr><th>Run</th><th>Event date</th><th>Repos</th><th>Significant</th><th>Flagged</th><th>Status</th></tr></thead>
            <tbody>
              {(runs || []).map(r => (
                <tr key={r.id}>
                  <td><Link to={`/runs/${r.id}`}><b>{r.name}</b></Link></td>
                  <td>{r.event_date || '-'}</td>
                  <td>{r.done_count}{r.total ? ` / ${r.total}` : ''}</td>
                  <td>{r.significant_count}</td>
                  <td className={r.flagged_count ? 'flagcell' : undefined}>{r.flagged_count}</td>
                  <td><span className={`pill ${r.status === 'done' ? 'done' : r.status === 'stopped' ? 'draft' : 'running'}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        Runs are stored server-side per organization - they survive restarts and are only
        visible to your org.
      </p>
    </Shell>
  )
}
