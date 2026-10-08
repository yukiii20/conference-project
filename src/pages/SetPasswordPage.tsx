import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getPasswordChecklist, resetPasswordSchema } from '../lib/validation'

/**
 * Landed on from the invitation email link. Supabase puts the invite token
 * in the URL hash; the client picks it up and either fires an auth event
 * (INVITED / PASSWORD_RECOVERY, depending on Supabase version) or the
 * session is simply present by the time getSession() resolves.
 */
export function SetPasswordPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && !cancelled) {
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
      setError(updateError.message)
      return
    }

    navigate('/convenor')
  }

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-ink">
        Checking your invitation…
      </div>
    )
  }

  if (status === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-ink">Link expired</h1>
          <p className="mt-3 text-sm text-ink/70">
            This link has expired. Ask the administrator to send a new invitation.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Set your password</h1>
        <p className="mt-1 text-sm text-ink/60">Choose a password to finish setting up your account.</p>

        {error ? (
          <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-ink">
                Password
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
              Confirm password
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
            {submitting ? 'Saving…' : 'Set password and continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
