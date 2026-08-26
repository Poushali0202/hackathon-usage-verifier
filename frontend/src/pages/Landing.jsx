import { Link } from 'react-router-dom'
import TopNav from '../components/TopNav.jsx'
import { TagPill } from '../components/bits.jsx'

// illustrative demo rows for the hero mini-grid - fictional projects, clearly not a real event
const DEMO_ROWS = [
  { p: 'Nebula Notes', team: 'Ada, Priya', tag: 'Significant', score: 7.5, bb: 'Yes', built: '2026-06-05' },
  { p: 'PromptPilot', team: 'Marcus T.', tag: 'Moderate', score: 3.0, bb: 'Yes', built: '2026-06-06' },
  { p: 'DriftDeck', team: 'Sam, Jo', tag: 'Significant', score: 6.0, bb: 'Yes', built: '2026-04-18 · pre-event', flag: true },
  { p: 'EchoTrail', team: 'Lena W.', tag: 'Less', score: 1.0, bb: 'No', built: 'in window' },
  { p: 'VaultVoice', team: 'Kiran', tag: 'None', score: 0.0, bb: 'No', built: 'in window' },
]

export default function Landing() {
  return (
    <>
      <TopNav />
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '56px 24px', textAlign: 'center' }}>
        <img className="astro lg" src="/astronaut.svg" alt="" />
        <div className="eyebrow">for hackathon sponsors, organizers &amp; builders</div>
        <h1 style={{ fontSize: 40, letterSpacing: '-1px', margin: '10px 0 12px' }}>
          Judge hackathons on <span className="hl">proof</span>, not claims.
        </h1>
        <p className="muted" style={{ fontSize: 16.5, maxWidth: 640, margin: '0 auto 26px' }}>
          Hack Judge reads every submitted repo and deterministically verifies that your product
          was really used - call sites, pipelines, deploys - then explains the verdict in plain
          language. Built at RocketRide, target-agnostic by design.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link className="btn" to="/sign-in">Start verifying →</Link>
          <Link className="btn ghost" to="/pricing">See pricing</Link>
        </div>

        <div className="glass heromock" style={{ margin: '44px auto 0' }}>
          <div className="winbar">
            <span className="windot" style={{ background: '#F93822' }} />
            <span className="windot" style={{ background: '#F5B914' }} />
            <span className="windot" style={{ background: '#2DC214' }} />
            <span style={{ marginLeft: 8, fontWeight: 700, fontSize: 12.5 }}>Frontier Demo Hackathon</span>
            <span className="muted" style={{ fontSize: 12 }}>· 24 / 24 verified</span>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>
              Significant 6 · Moderate 9 · Less 5 · None 4</span>
          </div>
          <table className="list" style={{ fontSize: 12.5 }}>
            <thead>
              <tr><th>Project</th><th>Tag</th><th>Score</th><th>Backbone</th><th>Built on</th></tr>
            </thead>
            <tbody>
              {DEMO_ROWS.map(d => (
                <tr key={d.p} className={d.flag ? 'flagged' : undefined}>
                  <td><b>{d.p}</b><div className="muted" style={{ fontSize: 10.5 }}>{d.team}</div></td>
                  <td><TagPill tag={d.tag} /></td>
                  <td className="scorecell">{d.score.toFixed(1)}</td>
                  <td>{d.bb}</td>
                  <td className={d.flag ? 'flagcell' : 'muted'} style={{ fontSize: 11.5 }}>{d.built}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ padding: '8px 14px', fontSize: 10.5, textAlign: 'right' }}>
            illustrative demo data
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginTop: 34, textAlign: 'left' }}>
          {[
            ['Ground-truth evidence', 'Every verdict cites the exact call sites, artifacts and commits it was scored on.'],
            ['Built-at-the-event checks', 'Commit-history freshness and tamper flags with a judge-set penalty. Company plan.'],
            ['Any product, your rubric', 'Define your target - SDK, platform or API - and tune the weights. Company plan.'],
          ].map(([h, p]) => (
            <div key={h} className="glass" style={{ padding: 18 }}>
              <b>{h}</b>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>{p}</p>
            </div>
          ))}
        </div>

        <div className="trustline">
          TRUSTED BY ROCKETRIDE · 5 EVENTS · 150+ REPOS VERIFIED
        </div>
      </div>
    </>
  )
}
