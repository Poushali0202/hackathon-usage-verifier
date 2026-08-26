import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import OrgMenu from './OrgMenu.jsx'
import ThemeToggle from './ThemeToggle.jsx'

// Authed app chrome: sidebar + page header, ported from the approved mockups.
export default function Shell({ title, wide = false, headRight = null, children }) {
  const { user } = useAuth()
  const cls = ({ isActive }) => (isActive ? 'cur' : undefined)
  return (
    <div className="shell">
      <aside className="side">
        <span className="brand">
          <img className="logo sm" src="/astronaut.svg" alt="" /> Hack Judge
        </span>
        <NavLink className={cls} to="/dashboard">▦ Dashboard</NavLink>
        <NavLink className={cls} to="/targets">🎯 Targets</NavLink>
        <NavLink className={cls} to="/runs/new">▶ New run</NavLink>
        <NavLink className={cls} to="/verify">⚡ Quick verify</NavLink>
        <NavLink className={cls} to="/runs" end>🧾 Runs</NavLink>
        <NavLink className={cls} to="/settings">⚙ Settings</NavLink>
        <span className="grow"></span>
        <div className="upgrade">
          <b>Upgrade your plan</b> <img className="astro" src="/astronaut.svg" alt="" /><br />
          Git freshness checks &amp; custom rubrics.<br />
          <Link className="btn sm" style={{ marginTop: 9 }} to="/pricing">See plans →</Link>
        </div>
      </aside>
      <main className="main" style={wide ? { maxWidth: 'none' } : undefined}>
        <div className="pagehead">
          <h1>{title}</h1>
          <span className="right">
            {headRight}
            <ThemeToggle />
            <OrgMenu />
            <span className="avatar">{(user?.name || 'P')[0]}</span>
          </span>
        </div>
        {children}
      </main>
    </div>
  )
}
