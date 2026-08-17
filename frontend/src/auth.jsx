import { createContext, useContext, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

// O-Connect STUB. The real integration goes through the RocketRide App Marketplace's
// O-Connect application (token format / org claims / embed-vs-redirect still to be
// confirmed with Shashi). Until then this fakes a signed-in session in localStorage so
// every authed page and route guard is already in place - swapping in real O-Connect
// should only touch this file.
const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hj_user')) } catch { return null }
  })
  const signIn = () => {
    const u = { name: 'Poushali', org: 'RocketRide Inc', via: 'o-connect-stub' }
    localStorage.setItem('hj_user', JSON.stringify(u))
    setUser(u)
  }
  const signOut = () => { localStorage.removeItem('hj_user'); setUser(null) }
  // dev-only: swap the stub identity (and therefore the tenant). Reload so every page
  // refetches under the new org. Real O-Connect replaces this with its org switcher.
  const switchUser = (name, org) => {
    localStorage.setItem('hj_user', JSON.stringify({ name, org, via: 'o-connect-stub' }))
    window.location.reload()
  }
  return <AuthCtx.Provider value={{ user, signIn, signOut, switchUser }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)

export function RequireAuth({ children }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/sign-in" state={{ from: loc.pathname }} replace />
  return children
}
