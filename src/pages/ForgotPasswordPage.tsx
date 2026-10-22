import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { forgotPasswordSchema } from '../lib/validation'
import { Alert, Button, Card, FormField, Input } from '../components/ui'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed = forgotPasswordSchema.safeParse({ email })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.')
      return
    }

    setSubmitting(true)
    await api.post('/auth/forgot-password', { email: parsed.data.email }).catch(() => {})
    setSubmitting(false)
    // Always show success, whether or not the email exists, so we don't leak
    // which addresses have accounts.
    setSent(true)
  }

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page-bg px-4">
        <Card className="w-full max-w-md text-center">
          <h1 className="text-xl font-semibold text-text">Check your email</h1>
          <p className="mt-3 text-sm text-text-muted">
            If an account exists for this email, we've sent a reset link. Check your inbox and spam folder.
          </p>
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
        <h1 className="text-xl font-semibold text-text">Reset your password</h1>
        <p className="mt-1 text-sm text-text-muted">
          Enter your email and we'll send you a link to reset it.
        </p>

        {error ? (
          <div className="mt-4">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <FormField label="Email" htmlFor="email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>

          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>

        <p className="mt-6 text-sm text-text-muted">
          <Link to="/login" className="font-medium text-brand underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </div>
  )
}
