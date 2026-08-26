// Local-only preferences. Everything else (targets, runs, results) moved to the server
// in M2 - see api.js. Settings stay client-side until a per-user prefs endpoint exists.

const read = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback }
}
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v))

// plan is a VISUAL PREVIEW ONLY (default 'company' - everyone gets everything until real
// entitlements arrive via App Marketplace billing). 'developer' shows the locked experience.
// Values match the public tier names; legacy stored values are migrated on read.
const LEGACY_PLANS = { pro: 'company', free: 'developer' }
export const getSettings = () => {
  const s = read('hj_settings', { grace_days: 2, history_penalty: 2, llm_key_set: false, plan: 'company' })
  s.plan = LEGACY_PLANS[s.plan] || s.plan || 'company'
  return s
}
export const saveSettings = (s) => write('hj_settings', s)
export const getPlan = () => getSettings().plan
