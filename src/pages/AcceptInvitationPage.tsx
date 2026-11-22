import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/authContext'
import { getPasswordChecklist, passwordSchema } from '../lib/validation'
import { portalPathForRoles } from '../components/ConferenceSwitcher'
import { AuthShell } from '../components/auth/AuthShell'
import { ConferenceAuthShell, type BrandedConference } from '../components/auth/ConferenceAuthShell'
import { Alert, Badge, Button, FormField, PasswordInput } from '../components/ui'
import { Skeleton } from '../components/ui/Spinner'

/** GET /api/invitations/:token (server/src/modules/invitations/service.ts PublicInvitation). */
type Invitation = {
  conference: { id: string; name: string; slug: string; logo_path: string | null; primary_color: string | null }
  role_code: string
  role_name: string
  inviter_name: string | null
  email: string
  full_name: string
  expires_at: string
  needs_password: boolean
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; invitation: Invitation }
  | { status: 'unusable'; message: string }

/**
 * /invitations/accept?token=... - the link in a conference invitation email. A brand-new account
 * chooses its password here; an existing account confirms with its current password (or is
 * accepted straight away when already signed in as that person). Accepting signs the person in at
 * that conference and opens their portal.
 */
export function AcceptInvitationPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim() ?? ''
  const [state, setState] = useState<LoadState>(token ? { status: 'loading' } : { status: 'unusable', message: 'This invitation link is incomplete. Open the link from the email again.' })

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api
      .get<{ invitation: Invitation }>(`/invitations/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', invitation: data.invitation })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          status: 'unusable',
          message: err instanceof ApiError ? err.message : "Can't reach the server. Check your connection and try again.",
        })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (state.status === 'loading') {
    return (
      <AuthShell title="Conference invitation" centered>
        <div className="space-y-3" aria-busy="true" aria-label="Loading invitation">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthShell>
    )
  }

  if (state.status === 'unusable') {
    return (
      <AuthShell title="This invitation can't be used" centered>
        <p className="text-center text-sm text-text-muted">{state.message}</p>
        <div className="mt-6 text-center">
          <Link to="/" className="conference-link font-medium text-brand underline-offset-4 hover:underline">
            Go to the home page
          </Link>
        </div>
      </AuthShell>
    )
  }

  return <InvitationForm token={token} invitation={state.invitation} />
}

function InvitationForm({ token, invitation }: { token: string; invitation: Invitation }) {
  const navigate = useNavigate()
  const { refresh, user } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<'accept' | 'decline' | null>(null)
  const [declined, setDeclined] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The invitation only carries the branding fields; the shell's other details are optional.
  const conference: BrandedConference = {
    ...invitation.conference,
    short_name: null,
    tagline: null,
    start_date: null,
    end_date: null,
    city: null,
    country: null,
  }
  const signedInAsInvitee = Boolean(user && user.email.toLowerCase() === invitation.email.toLowerCase())
  const askForPassword = !signedInAsInvitee
  const expires = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Kathmandu' }).format(new Date(invitation.expires_at))

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (askForPassword) {
      if (invitation.needs_password) {
        const parsed = passwordSchema.safeParse(password)
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Choose a stronger password.')
          return
        }
        if (password !== confirmPassword) {
          setError('The two passwords do not match.')
          return
        }
      } else if (!password) {
        setError('Enter your password to accept.')
        return
      }
    }

    setSubmitting('accept')
    try {
      const res = await api.post<{ roles: Array<{ role_code: string }>; conference: { slug: string } }>(
        `/invitations/${encodeURIComponent(token)}/accept`,
        askForPassword ? { password } : {},
      )
      await refresh()
      navigate(portalPathForRoles(res.roles.map((r) => r.role_code), res.conference.slug), { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept the invitation. Please try again.')
      setSubmitting(null)
    }
  }

  async function handleDecline() {
    setError(null)
    setSubmitting('decline')
    try {
      await api.post(`/invitations/${encodeURIComponent(token)}/decline`)
      setDeclined(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not decline the invitation. Please try again.')
    } finally {
      setSubmitting(null)
    }
  }

  if (declined) {
    return (
      <ConferenceAuthShell conference={conference} title="Invitation declined" centered>
        <p className="text-center text-sm text-text-muted">
          You declined the {invitation.role_name.toLowerCase()} role at {invitation.conference.name}. The organisers can invite you again if you change your mind.
        </p>
        <div className="mt-6 text-center">
          <Link to="/" className="conference-link font-medium text-brand underline-offset-4 hover:underline">
            Go to the home page
          </Link>
        </div>
      </ConferenceAuthShell>
    )
  }

  return (
    <ConferenceAuthShell
      conference={conference}
      title="You're invited"
      subtitle={
        <>
          {invitation.inviter_name ? `${invitation.inviter_name} invited you` : 'You have been invited'} to join{' '}
          <span className="font-medium text-text">{invitation.conference.name}</span> as{' '}
          <span className="font-medium text-text">{invitation.role_name}</span>.
        </>
      }
    >
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-border-soft bg-surface-muted px-4 py-3 text-sm">
        <dt className="text-text-muted">Name</dt>
        <dd className="font-medium text-text">{invitation.full_name}</dd>
        <dt className="text-text-muted">Email</dt>
        <dd className="min-w-0 font-medium text-text [overflow-wrap:anywhere]">
          {/* Long addresses wrap after the @ rather than mid-domain. */}
          {invitation.email.split('@')[0]}@<wbr />
          {invitation.email.split('@').slice(1).join('@')}
        </dd>
        <dt className="text-text-muted">Valid until</dt>
        <dd className="text-text">{expires}</dd>
      </dl>

      {error ? (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <form onSubmit={handleAccept} className="space-y-4">
        {signedInAsInvitee ? (
          <Alert variant="info">You're signed in as {invitation.email}, so no password is needed.</Alert>
        ) : invitation.needs_password ? (
          <>
            <FormField label="Choose a password" htmlFor="invite_password">
              <PasswordInput id="invite_password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
            <FormField label="Confirm password" htmlFor="invite_confirm_password">
              <PasswordInput
                id="invite_confirm_password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </FormField>
          </>
        ) : (
          <FormField label="Your password" htmlFor="invite_password" help="You already have an account. Enter its password to accept.">
            <PasswordInput id="invite_password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
        )}

        <Button type="submit" className="w-full" loading={submitting === 'accept'} disabled={submitting !== null}>
          Accept and continue
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={handleDecline} loading={submitting === 'decline'} disabled={submitting !== null}>
          Decline
        </Button>
      </form>
    </ConferenceAuthShell>
  )
}
