import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import TopNav from '../components/TopNav.jsx'

export default function SignIn() {
  const { signIn } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const go = () => { signIn(); nav(loc.state?.from || '/dashboard', { replace: true }) }
  return (
    <>
      <TopNav />
      <div className="authcard glass">
        <img src="/astronaut.svg" alt="" style={{ height: 64 }} className="astro" />
        <h2 style={{ margin: '10px 0 4px' }}>Sign in to Hack Judge</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          One account across the RocketRide App Marketplace.
        </p>
        <button className="btn" onClick={go}>
          Continue with O-Connect →
        </button>
        <div className="stubnote">
          Dev stub: creates a local session. The real O-Connect flow (RocketRide App
          Marketplace) replaces this button once integration details are confirmed.
        </div>
        <div className="trustline sm">
          TRUSTED AT ROCKETRIDE HACKATHONS · 150+ REPOS VERIFIED
        </div>
      </div>
    </>
  )
}
