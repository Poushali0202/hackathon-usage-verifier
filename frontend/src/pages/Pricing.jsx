import TopNav from '../components/TopNav.jsx'
import { Link } from 'react-router-dom'

// Blueprint Rev 2 (Joe-approved): no free tier, three prepaid tiers, tokens metered
// live with a hard stop at zero. Exact token allowances are still being finalized.
// Allowances follow Joe's rate: $5 per MB of code verified, repo math at the
// 500 KB average ($25 = 5 MB = 10 repos). [name, price, included, audience, features]
const TIERS = [
  ['Developer', '$20', '4 MB included · about 8 repos',
   'For individual builders checking their own projects', [
    '1 custom target',
    'Core scoring: verdict, backbone & evidence',
    'Small batch sheets',
    'Excel export',
  ], false],
  ['Company', '$100', '20 MB included · about 40 repos',
   'For sponsors verifying usage of their own product', [
    'Everything in Developer',
    'Several targets',
    'Git freshness & commit-history integrity checks',
    'Custom rubric & weights',
    'Larger batch sheets',
  ], true],
  ['Organizers', '$200', '40 MB included · about 80 repos',
   'For event teams judging across many sponsors', [
    'Everything in Company',
    'Unlimited targets & multi-target events',
    'Live streaming verification',
    'API access',
    'Unlimited batches, priority processing',
  ], false],
]

const METER_POINTS = [
  ['One simple rate', '$5 per MB of code verified, on every plan. An average repo is 500 KB, so about $2.50 per repo.'],
  ['Prepaid & metered live', 'Pay first, then use. Every verification draws your balance down by the code it actually scans.'],
  ['Hard stop at zero', 'The next run is refused the instant the balance is empty. Usage can never exceed what you paid.'],
  ['One-tap refill', 'Top up at the same $5/MB rate and work resumes immediately. Upgrades carry your remaining balance.'],
]

export default function Pricing() {
  return (
    <>
      <TopNav />
      <div style={{ maxWidth: 1020, margin: '0 auto', padding: '46px 24px' }}>
        <div className="eyebrow" style={{ textAlign: 'center' }}>pricing</div>
        <h1 style={{ textAlign: 'center', margin: '8px 0 6px' }}>Prepaid plans, metered by the repo</h1>
        <p className="muted" style={{ textAlign: 'center', margin: '0 0 30px' }}>
          Every plan includes a prepaid verification allowance that meters down in real
          time and stops at zero - you can never spend more than you've paid.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
          {TIERS.map(([name, price, included, who, feats, mid]) => (
            <div key={name} className="glass" style={{ padding: 22, borderColor: mid ? 'rgba(249,56,34,.5)' : undefined }}>
              <h3 style={{ margin: 0 }}>
                {name} {mid && <img className="astro" src="/astronaut.svg" alt="" />}
              </h3>
              <div style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 2px' }}>
                {price}<span className="muted" style={{ fontSize: 13, fontWeight: 600 }}> prepaid</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, margin: '0 0 4px' }}>{included}</div>
              <p className="muted" style={{ fontSize: 12.5, margin: '0 0 12px' }}>{who}</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.9 }}>
                {feats.map(f => <li key={f}>{f}</li>)}
              </ul>
              <Link className={`btn sm ${mid ? 'gold' : 'ghost'}`} style={{ marginTop: 16, display: 'inline-block' }} to="/sign-in">
                Choose {name} →
              </Link>
            </div>
          ))}
        </div>

        <div className="glass" style={{ padding: 22, marginTop: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>How metering works</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
            {METER_POINTS.map(([t, d]) => (
              <div key={t}>
                <b style={{ fontSize: 13.5 }}>{t}</b>
                <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0', lineHeight: 1.6 }}>{d}</p>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '14px 0 0' }}>
            Behind the scenes: each run reserves its maximum possible cost before it starts
            and settles the actual cost when it finishes, so a balance can never go negative.
          </p>
        </div>

        <p className="muted" style={{ textAlign: 'center', fontSize: 12, margin: '18px 0 0' }}>
          Repo counts assume the 500 KB average seen across events - big monorepos use
          more of the allowance, small projects less. Checkout and refills arrive with
          the marketplace integration (Stripe).
        </p>
      </div>
    </>
  )
}
