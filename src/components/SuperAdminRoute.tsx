import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { NotFoundPage } from '../pages/NotFoundPage'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const WARNING_MS = 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const

/**
 * Guards every /super-admin/* page. On denial this renders the same "Page
 * not found" page as any other bad URL — never an "access denied" message,
 * and never a redirect to a login page — so a non-admin probing the URL
 * learns nothing about whether it exists.
 *
 * The /super-admin path being unlinked anywhere in the UI is just tidiness
 * (nothing to stumble onto); the actual protection is this admin check on
 * every load. Identity comes only from useAuth()'s refresh(), i.e.
 * GET /api/auth/me — never from a client-side auth SDK session.
 */
export function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { refresh } = useAuth()
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking')

  useEffect(() => {
    let cancelled = false

    async function check() {
      setState('checking')
      const data = await refresh()
      if (!cancelled) setState(data?.isAdmin ? 'ok' : 'denied')
    }

    check()
    return () => {
      cancelled = true
    }
  }, [refresh])

  if (state === 'checking') {
    return <div className="min-h-screen bg-background" />
  }

  if (state === 'denied') {
    return <NotFoundPage />
  }

  return (
    <>
      {children}
      <AdminIdleGuard />
    </>
  )
}

/**
 * Signs the admin out after 30 minutes with no mouse/keyboard/touch
 * activity, warning them 1 minute beforehand. Lives at the route-guard
 * level (not inside SuperAdminPage) so it applies uniformly to every
 * /super-admin/* view without touching the admin panel itself.
 */
function AdminIdleGuard() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [warning, setWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(WARNING_MS / 1000)
  const warningRef = useRef(false)
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const signOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    warningRef.current = warning
  }, [warning])

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current)
    if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current)
    if (tickRef.current) clearInterval(tickRef.current)
  }, [])

  const signOutNow = useCallback(async () => {
    clearTimers()
    await signOut()
    navigate('/super-admin/login', { replace: true })
  }, [clearTimers, navigate, signOut])

  const resetIdle = useCallback(() => {
    clearTimers()
    setWarning(false)
    warnTimerRef.current = setTimeout(() => {
      setWarning(true)
      setSecondsLeft(WARNING_MS / 1000)
      tickRef.current = setInterval(() => {
        setSecondsLeft((s) => (s <= 1 ? 0 : s - 1))
      }, 1000)
    }, IDLE_TIMEOUT_MS - WARNING_MS)
    signOutTimerRef.current = setTimeout(() => {
      signOutNow()
    }, IDLE_TIMEOUT_MS)
  }, [clearTimers, signOutNow])

  useEffect(() => {
    resetIdle()
    const handler = () => {
      if (!warningRef.current) resetIdle()
    }
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, handler))
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, handler))
      clearTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!warning) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sa-idle-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-landing-navy-900/50 px-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
        <h2 id="sa-idle-title" className="text-lg font-semibold text-landing-text">
          You&rsquo;ll be signed out soon. Stay signed in?
        </h2>
        <p className="mt-2 text-sm text-landing-muted">
          You&rsquo;ve been inactive for a while. Signing out in {secondsLeft} s.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={resetIdle}
            className="flex-1 rounded-md bg-landing-navy-600 px-4 py-2 text-sm font-medium text-white hover:bg-landing-navy-800"
          >
            Stay signed in
          </button>
          <button
            type="button"
            onClick={signOutNow}
            className="flex-1 rounded-md border border-landing-border px-4 py-2 text-sm font-medium text-landing-text hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
