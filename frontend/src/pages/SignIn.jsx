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
          One account for your whole judging team.
        </p>
        <button className="btn" onClick={go}>
          Sign in →
        </button>
        <div className="stubnote">
          Dev preview: creates a local session. Real account sign-in ships with the
          marketplace integration.
        </div>
        <div className="trustline sm">
          BATTLE-TESTED AT LIVE HACKATHONS · 150+ REPOS VERIFIED
        </div>
      </div>
    </>
  )
}
