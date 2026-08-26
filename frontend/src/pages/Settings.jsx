import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell.jsx'
import { useAuth } from '../auth.jsx'
import { getSettings, saveSettings } from '../store.js'
import { getCredentials, saveCredentials } from '../api.js'

const CRED_FIELDS = [
  { key: 'ROCKETRIDE_LLM_API_KEY', label: 'LLM API key',
    hint: 'Shared by the organisation. Used only to write the plain-English explanations - verdicts are deterministic and never need it.' },
  { key: 'ROCKETRIDE_GITHUB_TOKEN', label: 'GitHub token',
    hint: 'Read-only public scope is enough - it only raises the GitHub rate limit for repo fetches.' },
]

export default function Settings() {
  const { user, signOut } = useAuth()
  const nav = useNavigate()
  const [s, setS] = useState(getSettings())
  const [saved, setSaved] = useState(false)
  const save = () => { saveSettings(s); setSaved(true); setTimeout(() => setSaved(false), 1500) }

  return (
    <Shell title="Settings">
      <div style={{ maxWidth: 640, display: 'grid', gap: 16 }}>
        <div className="glass" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Account</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="avatar">{(user?.name || 'P')[0]}</span>
            <div>
              <b>{user?.name}</b>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Signed in (dev preview) · org: {user?.org}
              </div>
            </div>
            <button className="btn ghost sm" style={{ marginLeft: 'auto' }}
                    onClick={() => { signOut(); nav('/') }}>Sign out</button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
            Dev preview session - the real account panel ships with the marketplace integration.
          </p>
        </div>

        <CredentialsCard />

        <div className="glass" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Plan preview</div>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Preview the app as</label>
            <select value={s.plan || 'company'} onChange={e => setS({ ...s, plan: e.target.value })}>
              <option value="company">Company & up (everything unlocked)</option>
              <option value="developer">Developer (Company features locked)</option>
            </select>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Visual preview only - real entitlements arrive with marketplace billing (Stripe).
            "Developer" shows the locked Built-on column, integrity flags and penalty
            control, which is how the upsell will look.
          </p>
          <button className="btn sm" style={{ marginTop: 10 }} onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
        </div>

        <div className="glass" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Run defaults</div>
          <div className="inline">
            <div className="field">
              <label>Grace days (event ±)</label>
              <input type="number" min="0" max="7" value={s.grace_days}
                     onChange={e => setS({ ...s, grace_days: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Pre-event work penalty (pts)</label>
              <input type="number" min="0" step="0.5" value={s.history_penalty}
                     onChange={e => setS({ ...s, history_penalty: Number(e.target.value) })} />
            </div>
          </div>
          <button className="btn sm" onClick={save}>{saved ? 'Saved ✓' : 'Save defaults'}</button>
        </div>
      </div>
    </Shell>
  )
}

// API credentials card - values go straight into RocketRide's encrypted environment
// keystore (org scope). The input never holds a stored value: the mask is the
// placeholder, blank input leaves a key alone, and there is no read-back.
function CredentialsCard() {
  const [info, setInfo] = useState(null)          // {keystore, keys:{KEY:{present,length}}}
  const [drafts, setDrafts] = useState({})
  const [status, setStatus] = useState('')

  const refresh = () => getCredentials().then(setInfo).catch(() => setInfo(null))
  useEffect(() => { refresh() }, [])

  const save = async () => {
    const filled = Object.fromEntries(Object.entries(drafts).filter(([, v]) => (v || '').trim()))
    if (!Object.keys(filled).length) { setStatus('Nothing to store.'); return }
    setStatus('Saving…')
    try {
      const res = await saveCredentials(filled)
      setDrafts({})
      setStatus(`Saved: ${(res.set || []).join(', ')}. New keys apply when the next pipeline starts.`)
      refresh()
    } catch (e) { setStatus(String(e.message || e)) }
  }

  const mask = (k) => {
    const rec = info?.keys?.[k]
    if (!rec?.present) return 'Paste the value…'
    return rec.length ? '•'.repeat(Math.min(rec.length, 32)) : '••••••••  (set)'
  }

  return (
    <div className="glass" style={{ padding: 20 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>API credentials</div>
      {CRED_FIELDS.map(f => (
        <div className="field" key={f.key} style={{ marginBottom: 10 }}>
          <label>
            {f.label}{' '}
            <span className="muted">
              {info?.keys?.[f.key]?.present ? '· in use' : info ? '· missing' : ''}
            </span>
          </label>
          <input type="password" autoComplete="off" value={drafts[f.key] || ''}
                 placeholder={mask(f.key)}
                 onChange={e => setDrafts({ ...drafts, [f.key]: e.target.value })} />
          <div className="help">{f.hint}</div>
        </div>
      ))}
      <button className="btn sm" onClick={save}>Save credentials</button>
      <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
        Stored in RocketRide's encrypted environment ({info?.keystore === false ? 'keystore unavailable here - keys fall back to the server environment' : 'org scope'});
        pipelines reference them by name and values are never shown again.
      </p>
      {status && <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>{status}</p>}
    </div>
  )
}
