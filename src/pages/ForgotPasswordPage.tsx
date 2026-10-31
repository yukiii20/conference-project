import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { forgotPasswordSchema } from '../lib/validation'
import { Alert, Button, FormField, Input } from '../components/ui'
import { AuthShell } from '../components/auth/AuthShell'
import { ConferenceAuthShell, type BrandedConference } from '../components/auth/ConferenceAuthShell'

/**
 * "Forgotten your password?" — generic at /forgot-password, branded at
 * /c/:slug/forgot-password (then the emailed link opens that conference's
 * branded reset page and returns the person to its sign-in page).
 */
export function ForgotPasswordPage({ conference }: { conference?: BrandedConference } = {}) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const signInHref = conference ? `/c/${encodeURIComponent(conference.slug)}/login` : '/login'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed = forgotPasswordSchema.safeParse({ email })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.')
      return
    }

    setSubmitting(true)
    await api
      .post('/auth/forgot-password', { email: parsed.data.email, ...(conference ? { conference: conference.slug } : {}) })
      .catch(() => {})
    setSubmitting(false)
    // Always show success, whether or not the email exists, so we don't leak
    // which addresses have accounts.
    setSent(true)
  }

  // A plain function (not a component defined during render) so the form isn't remounted on every keystroke.
  const shell = (props: { title: ReactNode; subtitle?: ReactNode; centered?: boolean; footer?: ReactNode; children: ReactNode }) =>
    conference ? <ConferenceAuthShell conference={conference} {...props} /> : <AuthShell {...props} />

  const backLink = (
    <Link to={signInHref} className="conference-link font-medium text-brand underline-offset-4 hover:underline">
      Back to sign in
    </Link>
  )

  if (sent) {
    return shell({
      title: 'Check your email',
      centered: true,
      footer: backLink,
      children: (
        <p className="text-center text-sm text-text-muted">
          If an account exists for this email, we've sent a reset link. Check your inbox and spam folder.
        </p>
      ),
    })
  }

  return shell({
    title: 'Reset your password',
    subtitle: "Enter your email and we'll send you a link to reset it.",
    footer: backLink,
    children: (
      <>
      {error ? (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>

        <Button type="submit" loading={submitting} className="w-full">
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      </>
    ),
  })
}
