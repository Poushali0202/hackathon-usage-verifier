// Small shared pieces: tag pill + tier-lock modal.
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
