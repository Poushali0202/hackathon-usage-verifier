// Small shared pieces: tag pill, tier-lock modal, allowance warning.
import { Link } from 'react-router-dom'
export function TagPill({ tag, failed }) {
  if (failed) return <span className="tag err">FAILED</span>
  const t = (tag || 'None').toLowerCase()
  const cls = t.startsWith('sig') ? 'sig' : t.startsWith('mod') ? 'mod' : t.startsWith('less') ? 'less' : 'none'
  return <span className={`tag ${cls}`}>{tag || 'None'}</span>
}

export function TierLockModal({ open, onClose, title, children, tier = 'company' }) {
  if (!open) return null
  return (
    <div className="modal-bg open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal glass">
        <h3>🔒 {title}</h3>
        <div style={{ fontSize: 13.5 }}>{children}</div>
        <div className="row" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost sm" onClick={onClose}>Not now</button>
          <a className="btn sm" href={`/pricing?highlight=${tier}`}>See plans →</a>
        </div>
      </div>
    </div>
  )
}

// Pre-run estimate said the sheet exceeds the plan's run allowance. Advisory only -
// the run still starts; rows past the settled KB budget come back as SKIPPED.
export function AllowanceWarning({ a }) {
  if (!a) return null
  const mb = (kb) => kb >= 1000 ? `${+(kb / 1000).toFixed(1)} MB` : `${kb} KB`
  const tierName = a.next_tier ? a.next_tier[0].toUpperCase() + a.next_tier.slice(1) : null
  return (
    <div className="dqline" style={{ margin: '10px 0' }}>
      ⚠ <b>This sheet likely exceeds your plan's run allowance.</b>{' '}
      Estimated ~{mb(a.estimated_kb)} of code vs a {mb(a.budget_kb)} allowance - roughly the
      first {a.est_verified_rows} repos will verify and the rest will be skipped.{' '}
      {tierName && <Link to={`/pricing?highlight=${a.next_tier}`} style={{ fontWeight: 700 }}>
        Upgrade to {tierName} →</Link>}{' '}
      <span className="muted">Metered top-ups for the overage arrive with checkout, at a
      higher per-KB rate than plan allowances.</span>
    </div>
  )
}
