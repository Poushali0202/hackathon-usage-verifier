import { useEffect, useState } from 'react'

// Dark-mode toggle. Theme lives on <html data-theme="..."> so pure CSS handles the rest;
// the choice persists in localStorage and main.jsx applies it before first paint (no flash).
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('hj_theme') || 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('hj_theme', theme)
  }, [theme])
  const dark = theme === 'dark'
  return (
    <button className="themebtn" title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(dark ? 'light' : 'dark')}>
      <span className="thumb">{dark ? '☀' : '🌙'}</span>
      {dark ? 'Light' : 'Dark'}
    </button>
  )
}
