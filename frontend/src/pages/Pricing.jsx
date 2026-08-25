import TopNav from '../components/TopNav.jsx'
import { Link } from 'react-router-dom'

const TIERS = [
  ['Free', '$0', ['Unlimited runs', 'Define your product as the target (1)', 'Default rubric', 'Excel export'], false],
  ['Pro', null, ['Everything in Free', 'Git freshness & integrity checks', 'Custom rubric & weights', 'Unlimited targets'], true],
  ['Enterprise', 'Talk to us', ['Multi-target events', 'API access', 'Run telemetry integrity ("Full")'], false],
]

export default function Pricing() {
  return (
    <>
      <TopNav />
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '46px 24px' }}>
        <div className="eyebrow" style={{ textAlign: 'center' }}>pricing</div>
        <h1 style={{ textAlign: 'center', margin: '8px 0 6px' }}>Simple plans for every event</h1>
        <p className="muted" style={{ textAlign: 'center', margin: '0 0 30px' }}>
          Billing arrives with the marketplace integration (Stripe). Final pricing
          is being coordinated - amounts below are placeholders.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
          {TIERS.map(([name, price, feats, pro]) => (
            <div key={name} className="glass" style={{ padding: 22, borderColor: pro ? 'rgba(249,56,34,.5)' : undefined }}>
              <h3 style={{ margin: 0 }}>
                {name} {pro && <img className="astro" src="/hackjudge-mark.svg" alt="" />}
              </h3>
              <div style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 12px' }}>
                {price ?? <span className="muted" style={{ fontSize: 15 }}>TBD</span>}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.9 }}>
                {feats.map(f => <li key={f}>{f}</li>)}
              </ul>
              <Link className={`btn sm ${pro ? 'gold' : 'ghost'}`} style={{ marginTop: 16, display: 'inline-block' }} to="/sign-in">
                {pro ? 'Go Pro →' : 'Get started'}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
