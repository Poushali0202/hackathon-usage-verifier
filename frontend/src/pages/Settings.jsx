import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell.jsx'
import { useAuth } from '../auth.jsx'
import { getSettings, saveSettings } from '../store.js'

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
                Signed in via O-Connect (RocketRide App Marketplace) · org: {user?.org}
              </div>
            </div>
            <button className="btn ghost sm" style={{ marginLeft: 'auto' }}
                    onClick={() => { signOut(); nav('/') }}>Sign out</button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
            Dev stub session - the real O-Connect account panel replaces this card.
          </p>
        </div>

        <div className="glass" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>LLM key (BYOK)</div>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>Anthropic API key <span className="muted">(used only to write explanations - scoring is deterministic)</span></label>
            <input type="password" placeholder={s.llm_key_set ? '••••••••••••  (set)' : 'sk-ant-…'}
                   onChange={e => setS({ ...s, llm_key_set: e.target.value.length > 0 })} />
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            v0 keeps the server's configured key; per-tenant keys are stored encrypted once the DB lands (M2).
          </p>
        </div>

        <div className="glass" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Plan preview</div>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Preview the app as</label>
            <select value={s.plan || 'pro'} onChange={e => setS({ ...s, plan: e.target.value })}>
              <option value="pro">Pro (everything unlocked)</option>
              <option value="free">Free (Pro features locked)</option>
            </select>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Visual preview only - real entitlements arrive with App Marketplace billing (Stripe +
            O-Connect). "Free" shows the locked Built-on column, integrity flags and penalty
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
