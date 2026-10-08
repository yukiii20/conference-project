import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, setRememberMe } from '../lib/supabase'
import { superAdminLoginSchema } from '../lib/validation'
import type { MyRoleRow } from '../lib/types'

const GENERIC_ERROR = 'Email or password is incorrect.'
const RATE_LIMIT_ERROR = 'Too many attempts. Wait a minute and try again.'
const NETWORK_ERROR = "Can't reach the server. Check your connection."

const LOCK_KEY = 'sa-login-lock'
const MAX_ATTEMPTS = 5
const LOCK_MS = 30_000

type LockState = { attempts: number; lockUntil: number | null }

function readLockState(): LockState {
  try {
    const raw = sessionStorage.getItem(LOCK_KEY)
    if (!raw) return { attempts: 0, lockUntil: null }
    const parsed = JSON.parse(raw) as Partial<LockState>
    return { attempts: Number(parsed.attempts) || 0, lockUntil: parsed.lockUntil ?? null }
  } catch {
    return { attempts: 0, lockUntil: null }
  }
}

function writeLockState(state: LockState) {
  try {
    sessionStorage.setItem(LOCK_KEY, JSON.stringify(state))
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — lockout just won't persist
  }
}

/** Only ever follow a same-site path that stays inside /super-admin, never the login page itself. */
function getSafeNext(searchParams: URLSearchParams): string {
  const next = searchParams.get('next')
  if (next && next.startsWith('/super-admin') && !next.startsWith('/super-admin/login')) {
    return next
  }
  return '/super-admin'
}

function classifySignInError(error: { status?: number; name?: string }): 'rate_limit' | 'network' | 'invalid' {
  if (error.status === 429) return 'rate_limit'
  if (!error.status || error.name === 'AuthRetryableFetchError') return 'network'
  return 'invalid'
}

export function SuperAdminLoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Administrator sign in'
    const tag = document.createElement('meta')
    tag.setAttribute('name', 'robots')
    tag.setAttribute('content', 'noindex, nofollow')
    document.head.appendChild(tag)
    return () => {
      document.title = prevTitle
      document.head.removeChild(tag)
    }
  }, [])

  // Already signed in as an admin? Skip straight past the form.
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const { data: userData } = await supabase.auth.getUser()
        if (!userData.user) {
          if (!cancelled) setCheckingSession(false)
          return
        }
        const { data: rolesData } = await supabase.rpc('get_my_roles')
        const roles = (rolesData ?? []) as MyRoleRow[]
        const isAdmin = roles.some((r) => r.role_code === 'admin')
        if (cancelled) return
        if (isAdmin) {
          navigate(getSafeNext(searchParams), { replace: true })
        } else {
          setCheckingSession(false)
        }
      } catch {
        if (!cancelled) setCheckingSession(false)
      }
    }

    check()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 5-strikes lockout, persisted in sessionStorage so a reload doesn't reset it.
  const [lockUntil, setLockUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const state = readLockState()
    if (state.lockUntil && state.lockUntil > Date.now()) {
      setLockUntil(state.lockUntil)
    } else if (state.lockUntil) {
      writeLockState({ attempts: 0, lockUntil: null })
    }
  }, [])

  useEffect(() => {
    if (!lockUntil) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [lockUntil])

  const lockSecondsLeft = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0
  const locked = lockSecondsLeft > 0

  useEffect(() => {
    if (lockUntil && lockSecondsLeft === 0) {
      writeLockState({ attempts: 0, lockUntil: null })
      setLockUntil(null)
    }
  }, [lockSecondsLeft, lockUntil])

  const recordFailedAttempt = useCallback(() => {
    const state = readLockState()
    const attempts = state.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCK_MS
      writeLockState({ attempts, lockUntil: until })
      setLockUntil(until)
      setNow(Date.now())
    } else {
      writeLockState({ attempts, lockUntil: null })
    }
  }, [])

  function handlePasswordKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (locked || submitting) return
    setFormError(null)

    const parsed = superAdminLoginSchema.safeParse({ email, password })
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) {
          nextErrors[key] = issue.message
        }
      }
      setFieldErrors(nextErrors)
      return
    }
    setFieldErrors({})
    setSubmitting(true)
    setRememberMe(false) // admin sessions live in sessionStorage only

    let signInError: { status?: number; name?: string } | null = null
    try {
      const result = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      })
      signInError = result.error
    } catch {
      setSubmitting(false)
      setFormError(NETWORK_ERROR)
      return
    }

    if (signInError) {
      setSubmitting(false)
      const kind = classifySignInError(signInError)
      if (kind === 'rate_limit') {
        setFormError(RATE_LIMIT_ERROR)
      } else if (kind === 'network') {
        setFormError(NETWORK_ERROR)
      } else {
        // Deliberately the exact same error as a non-admin account: this page
        // must never reveal that it's admin-only, or that the account exists.
        setFormError(GENERIC_ERROR)
        recordFailedAttempt()
      }
      return
    }

    let roles: MyRoleRow[] = []
    try {
      const { data: rolesData, error: rolesError } = await supabase.rpc('get_my_roles')
      if (rolesError) throw rolesError
      roles = (rolesData ?? []) as MyRoleRow[]
    } catch {
      setSubmitting(false)
      await supabase.auth.signOut()
      setFormError(NETWORK_ERROR)
      return
    }

    const isAdmin = roles.some((r) => r.role_code === 'admin')
    setSubmitting(false)

    if (!isAdmin) {
      await supabase.auth.signOut()
      setFormError(GENERIC_ERROR)
      recordFailedAttempt()
      return
    }

    writeLockState({ attempts: 0, lockUntil: null })
    navigate(getSafeNext(searchParams), { replace: true })
  }

  if (checkingSession) {
    return <div className="sa-login" />
  }

  return (
    <div className="sa-login">
      <div className="sa-login__topbar" />

      <header className="sa-login__header">
        <Link to="/" className="sa-login__brand">
          <LogoMark />
          <span className="sa-login__brand-name">Conference Management System</span>
        </Link>
        <span className="sa-login__divider" aria-hidden="true" />
        <span className="sa-login__brand-sub">Administration</span>
      </header>

      <main className="sa-login__main">
        <div className="sa-login__form-col">
          <h1 className="sa-login__heading">Sign in</h1>
          <p className="sa-login__subheading">Use your administrator account.</p>

          {formError || locked ? (
            <div className="sa-login__notices">
              {formError ? (
                <div role="alert" className="sa-login__notice">
                  {formError}
                </div>
              ) : null}
              {locked ? (
                <div role="alert" className="sa-login__notice">
                  Too many attempts. Try again in {lockSecondsLeft} s.
                </div>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} noValidate>
            <div className="sa-login__fields">
              <div>
                <label htmlFor="sa-email" className="sa-login__field-label">
                  Email
                </label>
                <input
                  id="sa-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={locked || submitting}
                  aria-invalid={fieldErrors.email ? true : undefined}
                  aria-describedby={fieldErrors.email ? 'sa-email-error' : undefined}
                  className="sa-login__input"
                />
                {fieldErrors.email ? (
                  <p id="sa-email-error" className="sa-login__field-error">
                    {fieldErrors.email}
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="sa-password" className="sa-login__field-label">
                  Password
                </label>
                <div className="sa-login__password-wrap">
                  <input
                    id="sa-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handlePasswordKey}
                    onKeyUp={handlePasswordKey}
                    disabled={locked || submitting}
                    aria-invalid={fieldErrors.password ? true : undefined}
                    aria-describedby={fieldErrors.password ? 'sa-password-error' : undefined}
                    className="sa-login__input sa-login__input--password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={locked || submitting}
                    className="sa-login__toggle"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {fieldErrors.password ? (
                  <p id="sa-password-error" className="sa-login__field-error">
                    {fieldErrors.password}
                  </p>
                ) : null}
                {capsLockOn ? <p className="sa-login__field-hint">Caps Lock is on.</p> : null}
              </div>

              <button type="submit" disabled={submitting || locked} className="sa-login__submit">
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>

          <Link to="/forgot-password" className="sa-login__forgot">
            Forgotten your password?
          </Link>
        </div>
      </main>

      <footer className="sa-login__footer">
        <span>© {new Date().getFullYear()} Conference Management System · Kathmandu, Nepal</span>
        <span>Activity on this console is recorded.</span>
      </footer>
    </div>
  )
}

/** The platform logo; falls back to initials if /logo.png fails to load. */
function LogoMark() {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span className="sa-login__brand-name">CMS</span>
  }
  return (
    <img
      src="/logo.png"
      alt="Conference Management System logo"
      className="sa-login__logo"
      onError={() => setFailed(true)}
    />
  )
}
