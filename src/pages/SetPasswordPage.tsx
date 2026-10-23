import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { getPasswordChecklist, resetPasswordSchema } from '../lib/validation'
import { Alert, Badge, Button, Card, FormField, PasswordInput } from '../components/ui'

/** Landed on from the invitation email link: /set-password?token=... */
export function SetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
      await api.post('/auth/accept-invitation', { token, password: parsed.data.password })
      navigate('/convenor')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not set your password. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page-bg px-4">
        <Card className="w-full max-w-md text-center">
          <h1 className="text-xl font-semibold text-text">Link expired</h1>
          <p className="mt-3 text-sm text-text-muted">
            This link has expired. Ask the administrator to send a new invitation.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page-bg px-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold text-text">Set your password</h1>
        <p className="mt-1 text-sm text-text-muted">Choose a password to finish setting up your account.</p>

        {error ? (
          <div className="mt-4">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <FormField label="Password" htmlFor="password">
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

          <FormField label="Confirm password" htmlFor="confirm_password">
            <PasswordInput
              id="confirm_password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </FormField>

          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Saving…' : 'Set password and continue'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
