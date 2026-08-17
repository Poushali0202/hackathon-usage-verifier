import { useState } from 'react'
import { ProModal, TagPill } from './bits.jsx'
import Tower from './Tower.jsx'
import { exportExcel } from '../api.js'
import { getPlan } from '../store.js'

// history_tampered and reused_pipelines are LISTS on the wire (empty = clean) - never
// truthiness-check them directly, an empty array is truthy in JS.
const tampered = (r) => (r.history_tampered?.length || 0) > 0
const flagged = (r) => !!r.project_predates || tampered(r) || (r.reused_pipelines?.length > 0)

function BuiltOn({ r }) {
  if (r.classify_failed || r.repo_accessible === false) return <span className="muted">-</span>
  if (!r.event_window) return <span className="muted">-</span>
  const bits = []
  if (r.earliest_commit) bits.push(String(r.earliest_commit).slice(0, 10))   // wire: "YYYY-MM-DD" string
  if (r.project_predates) bits.push('pre-event')
  if (tampered(r)) bits.push('tampered')
  if (r.reused_pipelines?.length) bits.push(`${r.reused_pipelines.length} reused`)
  if (!bits.length) return <span className="muted">in window</span>
  return <span className={flagged(r) ? 'flagcell' : undefined}>{bits.join(' · ')}</span>
}

const ext = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)
const teamNames = (names) =>
  String(names || '').split(/[,;&/]|\band\b/i).map(s => s.trim()).filter(s => s.length > 1)

function Detail({ r, pro }) {
  const team = teamNames(r.names)
  return (
    <td colSpan={6} style={{ padding: '10px 16px 18px' }}>
      {/* header: title, team byline, link buttons (gallery-style) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 21, letterSpacing: '-.3px', color: 'var(--ink2)' }}>
            {r.project || r.github}</h2>
          {team.length > 0 && <div className="muted" style={{ fontSize: 13 }}>by {team.join(', ')}</div>}
        </div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TagPill tag={r.tag} failed={r.classify_failed || r.repo_accessible === false} />
          {r.score != null && <span className="scorecell" style={{ fontSize: 15 }}>{Number(r.score).toFixed(1)}</span>}
        </span>
      </div>
      <div className="linksrow">
        {r.deployed && <a className="btn sm" href={ext(r.deployed)} target="_blank" rel="noreferrer">↗ Live demo</a>}
        {r.github && <a className="btn ghost sm" href={r.github} target="_blank" rel="noreferrer">⌨ Source code</a>}
        {r.demo && <a className="btn ghost sm" href={ext(r.demo)} target="_blank" rel="noreferrer">▷ Demo video</a>}
        {!r.deployed && !r.demo && r.github &&
          <span className="techchip" style={{ alignSelf: 'center' }}>not deployed</span>}
      </div>

      {!pro && (r.event_window || null) && (
        <div className="lockcard" style={{ margin: '6px 0 10px' }}>
          <h3>🔒 PRO - Commit-history integrity</h3>
          <p style={{ margin: 0 }}>Built-on dates, pre-event flags and tamper detection for this
            project are available on the Pro plan.</p>
        </div>
      )}
      {pro && (r.project_predates || tampered(r)) && (
        <div className="dqline">
          ⚠ <b>FLAGGED</b>{' '}
          {r.project_predates && <>- work goes back to <b>{String(r.earliest_commit || '').slice(0, 10)}</b>, before the event window {r.event_window ? `(${r.event_window[0]} → ${r.event_window[1]})` : ''}. </>}
          {tampered(r) && <>- commit-date rewriting detected: {r.history_tampered.slice(0, 3).map(t =>
            `${String(t.sha).slice(0, 7)} authored ${String(t.author).slice(0, 10)} but re-stamped ${String(t.committer).slice(0, 10)}`).join('; ')}. </>}
          Judge-set penalty applied: <b>−{r.history_penalty ?? 2}</b> pts - judge's call.
        </div>
      )}
      {pro && r.reused_pipelines?.length > 0 && (
        <div className="dqline" style={{ borderColor: 'rgba(245,158,11,.5)', background: '#FFF6E3' }}>
          ♻ Pipelines predating the event window: {r.reused_pipelines.join(', ')} (−1 reuse)
        </div>
      )}
      {r.description && <div className="detailbox"><b>What it is:</b> {r.description}</div>}
      {r.rocketride_usage && <div className="detailbox"><b>How {r.target_name || 'the target'} is used:</b> {r.rocketride_usage}</div>}
      {(r.platform?.domains?.length > 0 || r.platform?.files?.length > 0 || r.platform?.markers?.length > 0) && (
        <div className="detailbox">
          <b>Platform evidence:</b>
          {r.platform.domains?.length > 0 && <>{'\n'}Deployed on: {r.platform.domains.join(', ')}</>}
          {r.platform.files?.length > 0 && <>{'\n'}Artifacts: {r.platform.files.slice(0, 3).join(', ')}</>}
          {r.platform.markers?.length > 0 && <>{'\n'}Account/env markers: {r.platform.markers.slice(0, 4).join(', ')}</>}
        </div>
      )}
      {r.layers && <Tower layers={r.layers} backbone={r.backbone} label={r.target_name || 'RocketRide'} />}
      {r.pipelines?.length > 0 && (
        <div style={{ margin: '10px 0 4px' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Deterministic evaluation - ground truth</div>
          <div className="detailbox" style={{ padding: 0, overflowX: 'auto', whiteSpace: 'normal' }}>
            <table className="list" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Pipeline</th><th>Nodes</th><th>Complexity</th><th>Called?</th><th>Built on</th><th>Call sites (proof)</th></tr></thead>
              <tbody>
                {r.pipelines.map(p => (
                  <tr key={p.name}>
                    <td className="mono">{p.name}</td>
                    <td>{p.nodes}</td>
                    <td>{p.complexity}</td>
                    <td style={{ color: p.called ? 'var(--green-strong)' : 'var(--muted)', fontWeight: 700 }}>
                      {p.called ? '✓ called' : 'not called'}</td>
                    <td>{pro
                      ? (p.first_commit ? String(p.first_commit).slice(0, 10) : '-')
                      : '🔒 Pro'}</td>
                    <td className="mono" style={{ fontSize: 11, whiteSpace: 'pre-line' }}>
                      {(p.call_sites || []).slice(0, 3).map(s => `${s.file}:${s.line}`).join('\n') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {r.breakdown?.length > 0 && (
        <div style={{ margin: '8px 0 10px' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Score breakdown</div>
          {r.breakdown
            .filter(b => pro || !/FLAGGED|predates/i.test(String(b.signal)))
            .map((b, idx) => (
              <span key={idx} className={`bdchip ${b.points < 0 ? 'neg' : 'pos'}`}>
                {b.points > 0 ? '+' : ''}{b.points} {b.signal}
              </span>
            ))}
        </div>
      )}
      {r.justification && <div className="detailbox"><b>Verdict rationale:</b> {r.justification}</div>}
      {r.evidence?.length > 0 && (
        <div className="detailbox">
          <b>Ground truth:</b>
          {'\n'}{r.evidence.join('\n')}
        </div>
      )}
      {r.notes && <div className="detailbox" style={{ color: flagged(r) ? 'var(--red)' : undefined }}><b>Notes:</b> {r.notes}</div>}

      {/* footer: team + built-with (gallery-style) */}
      {(team.length > 0 || r.other_platforms?.length > 0 || r.target_name) && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--bd-subtle)' }}>
          {team.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Team</div>
              {team.map(n => (
                <span key={n} className="teamchip">
                  <span className="tinit">{n[0].toUpperCase()}</span> {n}
                </span>
              ))}
            </div>
          )}
          {(r.tag && r.tag !== 'None') || r.tech?.length > 0 || r.other_platforms?.length > 0 ? (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Built with <span className="muted"
                style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(detected from code)</span></div>
              {r.tag && r.tag !== 'None' && (
                <span className="techchip target">{r.target_name || 'RocketRide'}</span>
              )}
              {(r.tech || []).map(tch => (
                <span key={tch} className="techchip">{tch}</span>
              ))}
              {(r.other_platforms || [])
                .filter(p => !(r.tech || []).some(tch => tch.toLowerCase() === p.toLowerCase()))
                .map(p => (
                  <span key={p} className="techchip">{p}</span>
                ))}
            </div>
          ) : null}
        </div>
      )}
    </td>
  )
}

export default function ResultsGrid({ results, total, summary, exportName }) {
  const [open, setOpen] = useState(null)
  const [proModal, setProModal] = useState(false)
  const pro = getPlan() === 'pro'
  const done = results.length
  return (
    <div className="glass" style={{ padding: '6px 0 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px' }}>
        <b style={{ fontSize: 14 }}>{done}{total ? ` / ${total}` : ''} verified</b>
        {summary?.tags && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            {Object.entries(summary.tags).map(([t, n]) => `${t}: ${n}`).join(' · ')}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn ghost sm" disabled={!done}
                  onClick={() => exportExcel(results, exportName)}>⬇ Excel</button>
        </span>
      </div>
      <table className="list">
        <thead>
          <tr><th>Project</th><th>Tag</th><th>Score</th><th>Backbone</th><th>Built on</th><th>Time</th></tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <RowPair key={i} r={r} i={i} open={open} setOpen={setOpen} pro={pro}
                     onLock={() => setProModal(true)} />
          ))}
        </tbody>
      </table>
      <ProModal open={proModal} onClose={() => setProModal(false)}
                title="Commit-history integrity is a Pro feature">
        <p>Pro verifies every project was built at your event: earliest-commit dates against the
          event window, commit-date tamper detection, and a judge-set pre-event penalty.</p>
      </ProModal>
    </div>
  )
}

function RowPair({ r, i, open, setOpen, pro, onLock }) {
  return (
    <>
      <tr className={pro && flagged(r) ? 'flagged' : undefined} style={{ cursor: 'pointer' }}
          onClick={() => setOpen(open === i ? null : i)}>
        <td>
          <b>{r.project || r.github}</b>
          {r.names && <div className="muted" style={{ fontSize: 11.5 }}>{r.names}</div>}
        </td>
        <td><TagPill tag={r.tag} failed={r.classify_failed || r.repo_accessible === false} /></td>
        <td className="scorecell">{r.score != null ? Number(r.score).toFixed(1) : '-'}</td>
        <td>{r.backbone || '-'}</td>
        <td>{pro
          ? <BuiltOn r={r} />
          : <a href="#" style={{ fontSize: 12, fontWeight: 700 }}
               onClick={e => { e.preventDefault(); e.stopPropagation(); onLock() }}>🔒 Pro</a>}
        </td>
        <td className="muted">{r.seconds ? `${Math.round(r.seconds)}s` : '-'}</td>
      </tr>
      {open === i && <tr><Detail r={r} pro={pro} /></tr>}
    </>
  )
}
