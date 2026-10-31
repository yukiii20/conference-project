import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { forgotPasswordSchema } from '../lib/validation'
import { Alert, Button, FormField, Input } from '../components/ui'
import { AuthShell } from '../components/auth/AuthShell'

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
      <AuthShell title="Check your email" centered footer={
        <Link to="/login" className="font-medium text-brand underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }>
        <p className="text-center text-sm text-text-muted">
          If an account exists for this email, we've sent a reset link. Check your inbox and spam folder.
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to reset it."
      footer={
        <Link to="/login" className="font-medium text-brand underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
        {error ? (
          <div className="mb-4">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Email" htmlFor="email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>

          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
    </AuthShell>
  )
}
