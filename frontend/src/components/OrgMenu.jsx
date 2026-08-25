import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

// Dev identities the switcher can flip between. Each maps to its own tenant server-side
// (the X-Dev-User header). One entry hides the switcher section entirely; the real
// The real account panel populates this from the orgs in the user's token.
const DEV_ORGS = [
  { name: 'Poushali', org: 'RocketRide Inc' },
]

export default function OrgMenu() {
  const { user, signOut, switchUser } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)

  return (
    <span style={{ position: 'relative' }}>
      <button className="orgpill" style={{ cursor: 'pointer', font: 'inherit' }}
              onClick={() => setOpen(o => !o)}>
        {user?.org || 'RocketRide Inc'} ▾
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div className="glass orgmenu">
            <div style={{ padding: '10px 14px 8px' }}>
              <b style={{ fontSize: 13 }}>{user?.name}</b>
              <div className="muted" style={{ fontSize: 11.5 }}>{user?.org}</div>
            </div>
            <div className="omdiv" />
            <Link className="omitem" to="/settings" onClick={() => setOpen(false)}>⚙ Settings</Link>
            {DEV_ORGS.length > 1 && (
              <>
                <div className="omdiv" />
                <div className="omlabel">Switch org (dev)</div>
                {DEV_ORGS.map(d => (
                  <button key={d.name} className="omitem" onClick={() => switchUser(d.name, d.org)}>
                    {d.org === user?.org ? '● ' : '○ '}{d.org}
                  </button>
                ))}
              </>
            )}
            <div className="omdiv" />
            <button className="omitem" onClick={() => { signOut(); nav('/') }}>Sign out</button>
          </div>
        </>
      )}
    </span>
  )
}
