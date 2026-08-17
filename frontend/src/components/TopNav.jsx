import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import ThemeToggle from './ThemeToggle.jsx'

// Public-page chrome (landing / pricing).
export default function TopNav() {
  const { user } = useAuth()
  return (
    <nav className="topnav">
      <Link className="brand" to="/">
        <img className="logo only-light" src="/rocketride-icon-color.svg" alt="" />
        <img className="logo only-dark" src="/rocketride-icon-white.svg" alt="" /> Hack Judge
      </Link>
      <span className="links">
        <NavLink to="/pricing">Pricing</NavLink>
      </span>
      <span className="cta">
        <ThemeToggle />
        {user
          ? <Link className="btn sm" to="/dashboard">Open dashboard →</Link>
          : <>
              <Link className="btn ghost sm" to="/sign-in">Sign in</Link>
              <Link className="btn sm" to="/sign-in">Start verifying →</Link>
            </>}
      </span>
    </nav>
  )
}
