import { Routes, Route } from 'react-router-dom'
import { RequireAuth } from './auth.jsx'
import Landing from './pages/Landing.jsx'
import SignIn from './pages/SignIn.jsx'
import Pricing from './pages/Pricing.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Targets from './pages/Targets.jsx'
import NewRun from './pages/NewRun.jsx'
import QuickVerify from './pages/QuickVerify.jsx'
import Runs from './pages/Runs.jsx'
import RunResults from './pages/RunResults.jsx'
import Settings from './pages/Settings.jsx'

const authed = (el) => <RequireAuth>{el}</RequireAuth>

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/dashboard" element={authed(<Dashboard />)} />
      <Route path="/targets" element={authed(<Targets />)} />
      <Route path="/runs" element={authed(<Runs />)} />
      <Route path="/runs/new" element={authed(<NewRun />)} />
      <Route path="/verify" element={authed(<QuickVerify />)} />
      <Route path="/runs/:id" element={authed(<RunResults />)} />
      <Route path="/settings" element={authed(<Settings />)} />
    </Routes>
  )
}
