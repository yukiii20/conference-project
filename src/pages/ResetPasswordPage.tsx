import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { getPasswordChecklist, resetPasswordSchema } from '../lib/validation'
import { Alert, Badge, Button, FormField, PasswordInput } from '../components/ui'
import { AuthShell } from '../components/auth/AuthShell'

/** Landed on from the link in the reset email: /reset-password?token=... */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed = resetPasswordSchema.safeParse({ password, confirm_password: confirmPassword })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid password.')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/auth/reset-password', { token, password: parsed.data.password })
      setSuccess(true)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'We could not update your password. Request a new reset link and try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <AuthShell title="Link expired or invalid" centered>
        <p className="text-center text-sm text-text-muted">
          This password reset link is no longer valid. Request a new one to continue.
        </p>
        <div className="mt-6 text-center">
          <Link to="/forgot-password" className="font-medium text-brand underline-offset-4 hover:underline">
            Request a new link
          </Link>
        </div>
      </AuthShell>
    )
  }

  if (success) {
    return (
      <AuthShell title="Password updated" centered>
        <p className="text-center text-sm text-text-muted">You can now sign in with your new password.</p>
        <div className="mt-6 text-center">
          <Link to="/login" className="font-medium text-brand underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Set a new password">
        {error ? (
          <div className="mb-4">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="New password" htmlFor="password">
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <ul className="mt-2 space-y-1">
              {getPasswordChecklist(password).map((rule) => (
                <li key={rule.id}>
                  <Badge tone={rule.passed ? 'success' : 'neutral'}>
                    {rule.passed ? '✓' : '○'} {rule.label}
                  </Badge>
                </li>
              ))}
            </ul>
          </FormField>

          <FormField label="Confirm new password" htmlFor="confirm_password">
            <PasswordInput
              id="confirm_password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </FormField>

          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
    </AuthShell>
  )
}
