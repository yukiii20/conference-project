import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getPasswordChecklist, resetPasswordSchema } from '../lib/validation'

/**
 * Landed on from the link in the reset email. Supabase puts a recovery
 * token in the URL hash; the client picks it up and fires PASSWORD_RECOVERY
 * (or, if that already happened before we subscribed, getSession() will
 * just return the session directly).
 */
export function ResetPasswordPage() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !cancelled) {
        setStatus('ready')
      }
    })

    async function check() {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) {
        setStatus('ready')
        return
      }
      // The recovery hash can take a moment to be parsed; give it one retry.
      setTimeout(async () => {
        if (cancelled) return
        const { data: retry } = await supabase.auth.getSession()
        if (!cancelled) setStatus(retry.session ? 'ready' : 'invalid')
      }, 1500)
    }
    check()

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed = resetPasswordSchema.safeParse({ password, confirm_password: confirmPassword })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid password.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.password })
    setSubmitting(false)

    if (updateError) {
      setError('We could not update your password. Request a new reset link and try again.')
      return
    }

    await supabase.auth.signOut()
    setSuccess(true)
  }

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-ink">
        Checking your link…
      </div>
    )
  }

  if (status === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-ink">Link expired or invalid</h1>
          <p className="mt-3 text-sm text-ink/70">
            This password reset link is no longer valid. Request a new one to continue.
          </p>
          <Link to="/forgot-password" className="mt-6 inline-block font-medium text-button underline">
            Request a new link
          </Link>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-ink">Password updated</h1>
          <p className="mt-3 text-sm text-ink/70">You can now sign in with your new password.</p>
          <Link to="/login" className="mt-6 inline-block font-medium text-button underline">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Set a new password</h1>

        {error ? (
          <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-ink">
                New password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-sm text-button underline"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            <ul className="mt-2 space-y-1 text-sm">
              {getPasswordChecklist(password).map((rule) => (
                <li key={rule.id} className={rule.passed ? 'text-green-700' : 'text-ink/50'}>
                  {rule.passed ? '✓' : '○'} {rule.label}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label htmlFor="confirm_password" className="block text-sm font-medium text-ink">
              Confirm new password
            </label>
            <input
              id="confirm_password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-button px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
