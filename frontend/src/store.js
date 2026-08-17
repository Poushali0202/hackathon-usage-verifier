// Local-only preferences. Everything else (targets, runs, results) moved to the server
// in M2 - see api.js. Settings stay client-side until a per-user prefs endpoint exists.

const read = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback }
}
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v))

// plan is a VISUAL PREVIEW ONLY (default 'pro' - everyone gets everything until real
// entitlements arrive via App Marketplace billing). 'free' shows the locked experience.
export const getSettings = () =>
  read('hj_settings', { grace_days: 2, history_penalty: 2, llm_key_set: false, plan: 'pro' })
export const saveSettings = (s) => write('hj_settings', s)
export const getPlan = () => getSettings().plan || 'pro'
