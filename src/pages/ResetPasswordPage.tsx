import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { getPasswordChecklist, resetPasswordSchema } from '../lib/validation'
import { Alert, Badge, Button, Card, FormField, Input } from '../components/ui'

/** Landed on from the link in the reset email: /reset-password?token=... */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
      <div className="flex min-h-screen items-center justify-center bg-page-bg px-4">
        <Card className="w-full max-w-md text-center">
          <h1 className="text-xl font-semibold text-text">Link expired or invalid</h1>
          <p className="mt-3 text-sm text-text-muted">
            This password reset link is no longer valid. Request a new one to continue.
          </p>
          <Link to="/forgot-password" className="mt-6 inline-block font-medium text-brand underline">
            Request a new link
          </Link>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page-bg px-4">
        <Card className="w-full max-w-md text-center">
          <h1 className="text-xl font-semibold text-text">Password updated</h1>
          <p className="mt-3 text-sm text-text-muted">You can now sign in with your new password.</p>
          <Link to="/login" className="mt-6 inline-block font-medium text-brand underline">
            Back to sign in
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page-bg px-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold text-text">Set a new password</h1>

        {error ? (
          <div className="mt-4">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-text">
                New password
              </label>
              <Button type="button" variant="link" className="text-sm" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Hide' : 'Show'}
              </Button>
            </div>
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
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
          </div>

          <FormField label="Confirm new password" htmlFor="confirm_password">
            <Input
              id="confirm_password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </FormField>

          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
