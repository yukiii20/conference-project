import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../lib/authContext'
import { SignInForm } from '../../components/auth/SignInForm'
import { ConferenceAuthShell, WithConference, type BrandedConference } from '../../components/auth/ConferenceAuthShell'
import { portalPathForRoles } from '../../components/ConferenceSwitcher'
import { Alert } from '../../components/ui'

/** /c/:slug/login — this conference's own sign-in page. */
export function ConferenceLoginPage() {
  const { slug } = useParams()

  return (
    <WithConference slug={slug} notFoundExtra={slug ? <UnpublishedConferenceSignIn slug={slug} /> : null}>
      {(conference) => <BrandedLogin conference={conference} />}
    </WithConference>
  )
}

function BrandedLogin({ conference }: { conference: BrandedConference }) {
  const conferenceSlug = conference.slug
  const conferenceId = conference.id
  const { refresh, user, conference: sessionConference, roles } = useAuth()

  // Know whether someone is already signed in here, so we can offer their portal instead of a second sign-in.
  useEffect(() => {
    void refresh()
  }, [refresh])

  const encodedSlug = encodeURIComponent(conferenceSlug)
  const signedInHere = Boolean(user && sessionConference?.id === conferenceId)
  const signedInElsewhere = Boolean(user && sessionConference && sessionConference.id !== conferenceId)

  return (
    <ConferenceAuthShell
      conference={conference}
      title="Sign in"
      subtitle={`Welcome back. Sign in to continue to ${conference.name}.`}
      footer={
        <>
          New to {conference.short_name || conference.name}?{' '}
          <Link to={`/c/${encodedSlug}/signup`} className="conference-link font-medium text-brand underline-offset-4 hover:underline">
            Create an account or request a role
          </Link>
        </>
      }
    >
      {signedInHere ? (
        <div className="mb-5">
          <Alert variant="success">
            <p>
              You're already signed in as <span className="font-medium">{user?.full_name}</span>.
            </p>
            <Link
              to={portalPathForRoles(
                roles.map((r) => r.role_code),
                conferenceSlug,
              )}
              className="mt-3 inline-flex min-h-9 items-center rounded-lg bg-button px-3 text-sm font-medium text-white hover:bg-button-hover"
            >
              Open your portal
            </Link>
          </Alert>
        </div>
      ) : null}
      {signedInElsewhere ? (
        <div className="mb-5">
          <Alert variant="info">
            You're signed in at {sessionConference?.name}. Signing in here starts a session for {conference.name} instead.
          </Alert>
        </div>
      ) : null}
      <SignInForm conferenceSlug={conferenceSlug} />
    </ConferenceAuthShell>
  )
}

/**
 * The public endpoint can't tell an unknown slug from a conference that
 * isn't published yet (both 404, so nothing leaks). Organisers still have to
 * reach a draft conference to set it up, so the "not found" page offers a
 * plain sign-in for this address — the server decides whether the
 * conference exists and whether the person has a role there.
 */
function UnpublishedConferenceSignIn({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-6 text-center">
      {open ? (
        <div className="rounded-2xl border border-border-soft bg-surface p-6 text-left shadow-card">
          <h2 className="font-display text-lg font-semibold text-text">Organiser sign-in</h2>
          <p className="mb-4 mt-1 text-sm text-text-muted">For organisers of a conference that isn't published yet.</p>
          <SignInForm conferenceSlug={slug} />
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="text-sm text-text-muted underline-offset-4 hover:text-text hover:underline">
          Organising a conference that isn't published yet? Sign in here
        </button>
      )}
    </div>
  )
}
