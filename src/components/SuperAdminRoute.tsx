import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/authContext'
import { NotFoundPage } from '../pages/NotFoundPage'
import { Button, Spinner } from './ui'
import { forgetAdminSession, hadAdminSession, rememberAdminSession, resolveGuardState, type GuardState } from './superAdminGuard'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const WARNING_MS = 60 * 1000
/** While the admin is active, tell the server at most this often, so its own 30-minute idle clock doesn't run out under someone who is only reading and scrolling. */
const KEEP_ALIVE_MS = 5 * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const

/**
 * Guards every /super-admin/* page. Someone who is not an admin gets the same
 * "Page not found" page as any other bad URL — never an "access denied" message,
 * and never a redirect to a login page — so a non-admin probing the URL
 * learns nothing about whether it exists.
 *
 * Two cases are deliberately NOT treated as denial (they used to be, which showed
 * admins "Page not found" after a refresh):
 *  - the server could not be reached (Render waking up, 502/503, network): retried,
 *    then a "Could not reach the server" page with Retry;
 *  - this browser tab had a confirmed admin session that has since ended (idle
 *    timeout): "Your admin session expired" with a way back to the same page.
 *
 * The /super-admin path being unlinked anywhere in the UI is just tidiness
 * (nothing to stumble onto); the actual protection is this admin check on
 * every load. Identity comes only from useAuth()'s refresh(), i.e.
 * GET /api/auth/me — never from a client-side auth SDK session.
 */
export function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { checkSession } = useAuth()
  const location = useLocation()
  const [state, setState] = useState<GuardState>('checking')
  const [slow, setSlow] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('checking')
    setSlow(false)
    // checkSession() retries by itself (1 s, 3 s, 6 s); say so once the first try has clearly not answered.
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(true)
    }, 1500)

    checkSession().then((result) => {
      if (cancelled) return
      clearTimeout(slowTimer)
      const next = resolveGuardState(result, hadAdminSession())
      if (next === 'ok') rememberAdminSession()
      setState(next)
    })

    return () => {
      cancelled = true
      clearTimeout(slowTimer)
    }
  }, [checkSession, attempt])

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4" aria-live="polite">
        {slow ? (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Spinner size="sm" /> The server is waking up, please wait…
          </p>
        ) : null}
      </div>
    )
  }

  if (state === 'unreachable') {
    return (
      <GuardMessage
        title="Could not reach the server"
        body="The server did not answer. It may be restarting, or your connection dropped. Your session has not been ended."
        action={<Button onClick={() => setAttempt((n) => n + 1)}>Retry</Button>}
      />
    )
  }

  if (state === 'expired') {
    const next = encodeURIComponent(location.pathname + location.search)
    return (
      <GuardMessage
        title="Your admin session expired"
        body="You were signed out after a period of inactivity. Sign in again to return to the page you were on."
        action={
          <Link
            to={`/super-admin/login?next=${next}`}
            onClick={forgetAdminSession}
            className="inline-flex min-h-10 items-center rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:bg-button-hover"
          >
            Sign in again
          </Link>
        }
      />
    )
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

function GuardMessage({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div role="alert" className="w-full max-w-md rounded-lg border border-border bg-surface p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        <p className="mt-2 text-sm text-text-muted">{body}</p>
        <div className="mt-5 flex justify-center">{action}</div>
      </div>
    </div>
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

  const lastKeepAliveRef = useRef(Date.now())

  /** `timedOut`: the idle timer ended the session (say so on the login page and come back here afterwards). */
  const signOutNow = useCallback(
    async (timedOut = false) => {
      clearTimers()
      const here = window.location.pathname + window.location.search
      await signOut()
      forgetAdminSession()
      navigate(timedOut ? `/super-admin/login?expired=1&next=${encodeURIComponent(here)}` : '/super-admin/login', { replace: true })
    },
    [clearTimers, navigate, signOut],
  )

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
      signOutNow(true)
    }, IDLE_TIMEOUT_MS)
  }, [clearTimers, signOutNow])

  /** Activity in the browser must also count as activity on the server, or its idle clock expires first. */
  const keepAlive = useCallback((force = false) => {
    const now = Date.now()
    if (!force && now - lastKeepAliveRef.current < KEEP_ALIVE_MS) return
    lastKeepAliveRef.current = now
    api.get('/auth/session').catch(() => {
      // A failed ping is not a sign-out; the next real request decides.
    })
  }, [])

  useEffect(() => {
    resetIdle()
    const handler = () => {
      if (warningRef.current) return
      resetIdle()
      keepAlive()
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-surface p-6 shadow-lg">
        <h2 id="sa-idle-title" className="text-lg font-semibold text-text">
          You&rsquo;ll be signed out soon. Stay signed in?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          You&rsquo;ve been inactive for a while. Signing out in {secondsLeft} s.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => {
              resetIdle()
              keepAlive(true)
            }}
            className="min-h-10 flex-1 rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:bg-button-hover"
          >
            Stay signed in
          </button>
          <button
            type="button"
            onClick={() => signOutNow()}
            className="min-h-10 flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-muted"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
