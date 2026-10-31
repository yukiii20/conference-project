import { useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/authContext'
import { getPasswordChecklist, resetPasswordSchema } from '../lib/validation'
import type { MyRoleRow } from '../lib/types'
import { Alert, Badge, Button, FormField, PasswordInput } from '../components/ui'
import { AuthShell } from '../components/auth/AuthShell'
import { BrandedOrPlainShell, ConferenceAuthShell, type BrandedConference } from '../components/auth/ConferenceAuthShell'
import { portalPathForRoles } from '../components/ConferenceSwitcher'

type AcceptResponse = { roles: MyRoleRow[]; signed_in: boolean }

/**
 * Landed on from the invitation email link: /set-password?token=...&conference=<slug>.
 * With the conference, the page is branded (when that conference is published)
 * and the person is signed straight in to it; without one, they're sent to sign in.
 */
export function SetPasswordPage() {
  const [searchParams] = useSearchParams()
  const conferenceSlug = searchParams.get('conference')?.trim() || null

  return (
    <BrandedOrPlainShell
      slug={conferenceSlug}
      plain={() => <SetPasswordContent slug={conferenceSlug} />}
      branded={(conference) => <SetPasswordContent slug={conference.slug} conference={conference} />}
    />
  )
}

function SetPasswordContent({ slug, conference }: { slug: string | null; conference?: BrandedConference }) {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const shell = (props: { title: ReactNode; subtitle?: ReactNode; centered?: boolean; children: ReactNode }) =>
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
      const data = await api.post<AcceptResponse>('/auth/accept-invitation', {
        token,
        password: parsed.data.password,
        ...(slug ? { conference: slug } : {}),
      })
      if (data.signed_in && slug) {
        // Signed in to the conference the invitation was for: open its portal in the right role.
        await refresh()
        navigate(portalPathForRoles(data.roles.map((r) => r.role_code), slug), { replace: true })
      } else {
        navigate(slug ? `/c/${encodeURIComponent(slug)}/login` : '/login', { replace: true })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not set your password. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return shell({
      title: 'Link expired',
      centered: true,
      children: (
        <p className="text-center text-sm text-text-muted">This link has expired. Ask the administrator to send a new invitation.</p>
      ),
    })
  }

  return shell({
    title: 'Set your password',
    subtitle: conference
      ? `Choose a password to finish setting up your account for ${conference.name}.`
      : 'Choose a password to finish setting up your account.',
    children: (
      <>
        {error ? (
          <div className="mb-4">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Password" htmlFor="password">
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
      </>
    ),
  })
}
