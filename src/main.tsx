import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

/**
 * Identity now comes only from the MySQL-backed session cookie via
 * GET /api/auth/me. Any Supabase auth token left over in localStorage from
 * before this migration (keys named "sb-...") is pure stale state — at best
 * unused, at worst a source of a page reading the wrong signed-in user — so
 * it's wiped on every app start.
 */
function clearLeftoverSupabaseAuthKeys() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-')) localStorage.removeItem(key)
    }
  } catch {
    // localStorage unavailable (e.g. private browsing) — nothing to clear
  }
}

clearLeftoverSupabaseAuthKeys()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
