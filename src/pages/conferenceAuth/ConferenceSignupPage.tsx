import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/authContext'
import { SIGNUP_ROLE_CODES, getRoleDefinition } from '../../lib/roles'
import { SignUpForm } from '../../components/auth/SignUpForm'
import { ConferenceAuthShell, WithConference, type BrandedConference } from '../../components/auth/ConferenceAuthShell'
import { Alert, Button, Skeleton } from '../../components/ui'

/** /c/:slug/signup — create an account at this conference, or ask for a role here with an existing one. */
export function ConferenceSignupPage() {
  const { slug } = useParams()
  return <WithConference slug={slug}>{(conference) => <BrandedSignup conference={conference} />}</WithConference>
}

function BrandedSignup({ conference }: { conference: BrandedConference }) {
  const { refresh, user, signOut } = useAuth()
  const [checked, setChecked] = useState(false)
  const encodedSlug = encodeURIComponent(conference.slug)

  // Signed in (at any conference)? Then they ask for a role with the account they're using — no password, no new account.
  useEffect(() => {
    let cancelled = false
    refresh().finally(() => {
      if (!cancelled) setChecked(true)
    })
    return () => {
      cancelled = true
    }
  }, [refresh])

  return (
    <ConferenceAuthShell
      conference={conference}
      title={user ? 'Request a role' : 'Create an account'}
      subtitle={
        user
          ? `Ask the convenor of ${conference.name} for a role.`
          : `Sign up for ${conference.name}. Already have an account on this platform? Use the same email — we'll ask for its password.`
      }
      wide
      footer={
        user ? null : (
          <>
            Already have a role here?{' '}
            <Link to={`/c/${encodedSlug}/login`} className="conference-link font-medium text-brand underline-offset-4 hover:underline">
              Sign in
            </Link>
          </>
        )
      }
    >
      {!checked ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : user ? (
        <RequestRoleAsSignedIn
          conference={conference}
          name={user.full_name}
          email={user.email}
          onSignOut={async () => {
            await signOut()
          }}
        />
      ) : (
        <SignUpForm preselectedSlug={conference.slug} showSignInLink />
      )}
    </ConferenceAuthShell>
  )
}

function RequestRoleAsSignedIn({
  conference,
  name,
  email,
  onSignOut,
}: {
  conference: BrandedConference
  name: string
  email: string
  onSignOut: () => Promise<void>
}) {
  const [role, setRole] = useState('')
  const [roleError, setRoleError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (!role) {
      setRoleError('Choose a role to continue.')
      return
    }
    setRoleError(null)
    setSubmitting(true)
    try {
      const data = await api.post<{ message: string }>('/auth/request-role', { requested_role: role, conference: conference.slug })
      setDone(data.message)
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'role_request_pending' || err.code === 'role_already_active')) {
        setNotice(err.message)
      } else {
        setError(err instanceof ApiError ? err.message : "Can't reach the server. Check your connection.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 size={36} className="mx-auto text-success" aria-hidden="true" />
        <h2 className="mt-3 font-display text-xl font-semibold text-text">Request sent</h2>
        <p className="mt-2 text-sm text-text-muted">{done}</p>
        <Link
          to={`/c/${encodeURIComponent(conference.slug)}`}
          className="conference-link mt-6 inline-block text-sm font-medium text-brand underline-offset-4 hover:underline"
        >
          Back to {conference.short_name || conference.name}
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <p className="rounded-xl bg-page-bg px-4 py-3 text-sm text-text">
        You are signed in as <span className="font-medium">{name}</span> ({email}). Request a role at{' '}
        <span className="font-medium">{conference.name}</span>.
      </p>

      {error ? <Alert variant="danger">{error}</Alert> : null}
      {notice ? <Alert variant="info">{notice}</Alert> : null}

      <fieldset>
        <legend className="text-sm font-medium text-text">Role</legend>
        {roleError ? (
          <p className="mt-1 text-sm text-danger" role="alert">
            {roleError}
          </p>
        ) : null}
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SIGNUP_ROLE_CODES.map((code) => (
            <label
              key={code}
              className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                role === code ? 'border-button bg-indigo-soft ring-2 ring-button/30' : 'border-border hover:border-button/50'
              }`}
            >
              <input
                type="radio"
                name="requested_role"
                value={code}
                checked={role === code}
                onChange={() => {
                  setRole(code)
                  setRoleError(null)
                }}
                className="accent-[var(--color-button)]"
              />
              {getRoleDefinition(code)?.label ?? code}
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" loading={submitting} className="w-full">
        {submitting ? 'Sending…' : `Request role at ${conference.short_name || conference.name}`}
      </Button>

      <p className="text-center text-sm text-text-muted">
        Not you?{' '}
        <button
          type="button"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true)
            await onSignOut()
            setSigningOut(false)
          }}
          className="conference-link font-medium text-brand underline-offset-4 hover:underline disabled:opacity-60"
        >
          Sign out
        </button>{' '}
        to create a different account.
      </p>
    </form>
  )
}
