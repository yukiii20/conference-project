import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/authContext'
import { getPasswordChecklist, resetPasswordSchema } from '../lib/validation'
import { Alert, Badge, Button, Card, FormField, PasswordInput, Spinner } from '../components/ui'

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [checking, setChecking] = useState(true)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false
    refresh().then((data) => {
      if (cancelled) return
      if (data) {
        setChecking(false)
      } else {
        navigate('/login')
      }
    })
    return () => {
      cancelled = true
    }
  }, [navigate, refresh])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!currentPassword) {
      setError('Enter your current password.')
      return
    }

    const parsed = resetPasswordSchema.safeParse({ password, confirm_password: confirmPassword })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid password.')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: parsed.data.password,
      })
      setCurrentPassword('')
      setPassword('')
      setConfirmPassword('')
      setSuccess(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not update your password.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page-bg text-text">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page-bg px-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold text-text">Change password</h1>
        <p className="mt-1 text-sm text-text-muted">Set a new password for your account.</p>

        {error ? (
          <div className="mt-4">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}
        {success ? (
          <div className="mt-4">
            <Alert variant="success">Password updated.</Alert>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <FormField label="Current password" htmlFor="current_password">
            <PasswordInput
              id="current_password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </FormField>

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

          <Button type="submit" loading={submitting}>
            {submitting ? 'Saving…' : 'Update password'}
          </Button>
        </form>

        <p className="mt-6 text-sm text-text-muted">
          <Link to="/login" className="font-medium text-brand underline">
            Back
          </Link>
        </p>
      </Card>
    </div>
  )
}
