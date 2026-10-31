import { useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { getPasswordChecklist, resetPasswordSchema } from '../lib/validation'
import { Alert, Badge, Button, FormField, PasswordInput } from '../components/ui'
import { AuthShell } from '../components/auth/AuthShell'
import { BrandedOrPlainShell, ConferenceAuthShell, type BrandedConference } from '../components/auth/ConferenceAuthShell'

/**
 * Landed on from the link in the reset email:
 *   /c/:slug/reset-password?token=...   (branded; sent when the reset was asked for at a conference)
 *   /reset-password?token=...           (plain; older links and resets asked for without a conference)
 */
export function ResetPasswordPage() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const conferenceSlug = slug?.trim() || searchParams.get('conference')?.trim() || null

  return (
    <BrandedOrPlainShell
      slug={conferenceSlug}
      plain={() => <ResetPasswordContent slug={conferenceSlug} />}
      branded={(conference) => <ResetPasswordContent slug={conference.slug} conference={conference} />}
    />
  )
}

function ResetPasswordContent({ slug, conference }: { slug: string | null; conference?: BrandedConference }) {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const encodedSlug = slug ? encodeURIComponent(slug) : null
  const signInHref = encodedSlug ? `/c/${encodedSlug}/login` : '/login'
  const forgotHref = encodedSlug ? `/c/${encodedSlug}/forgot-password` : '/forgot-password'

  const shell = (props: { title: ReactNode; centered?: boolean; children: ReactNode }) =>
    conference ? <ConferenceAuthShell conference={conference} {...props} /> : <AuthShell {...props} />

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
        err instanceof ApiError ? err.message : 'We could not update your password. Request a new reset link and try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return shell({
      title: 'Link expired or invalid',
      centered: true,
      children: (
        <>
          <p className="text-center text-sm text-text-muted">
            This password reset link is no longer valid. Request a new one to continue.
          </p>
          <div className="mt-6 text-center">
            <Link to={forgotHref} className="conference-link font-medium text-brand underline-offset-4 hover:underline">
              Request a new link
            </Link>
          </div>
        </>
      ),
    })
  }

  if (success) {
    return shell({
      title: 'Password updated',
      centered: true,
      children: (
        <>
          <p className="text-center text-sm text-text-muted">You can now sign in with your new password.</p>
          <div className="mt-6 text-center">
            <Link to={signInHref} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-button px-4 text-sm font-medium text-white hover:bg-button-hover">
              {conference ? `Sign in to ${conference.name}` : 'Back to sign in'}
            </Link>
          </div>
        </>
      ),
    })
  }

  return shell({
    title: 'Set a new password',
    children: (
      <>
        {error ? (
          <div className="mb-4">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="New password" htmlFor="password">
            <PasswordInput id="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
      </>
    ),
  })
}
