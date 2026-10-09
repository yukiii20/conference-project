import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { getRoleDefinition } from '../lib/roles'
import { PortalHeader } from '../components/PortalHeader'
import { AssignmentsList } from './reviewer/AssignmentsList'
import { ReviewForm } from './reviewer/ReviewForm'

type ReviewerConference = { id: string; name: string; slug: string }

export function ReviewerPage() {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null
  const { roles } = useAuth()

  const [myConferences, setMyConferences] = useState<ReviewerConference[]>([])
  const [conferenceId, setConferenceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<{ assignmentId: string; submissionId: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // The conference selector comes only from GET /api/auth/me (via the
  // shared auth context) — never from a client-side auth SDK session.
  useEffect(() => {
    const options: ReviewerConference[] = roles
      .filter((r) => r.role_code === 'reviewer' && r.conference_id)
      .map((r) => ({ id: r.conference_id as string, name: r.conference_name ?? '', slug: r.conference_slug ?? '' }))

    setMyConferences(options)
    const preselected = preselectedSlug ? options.find((c) => c.slug === preselectedSlug) : null
    setConferenceId((preselected ?? options[0])?.id ?? null)
    setLoading(false)
  }, [roles, preselectedSlug])

  function handleSwitchConference(id: string) {
    setConferenceId(id)
    setOpen(null)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="min-h-screen bg-background text-ink">
      <PortalHeader roleLabel={getRoleDefinition('reviewer')?.label ?? 'Reviewer'} />

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Reviewer</h1>

        {myConferences.length > 1 ? (
          <div className="mt-3">
            <label htmlFor="reviewer-conference" className="block text-xs font-medium text-ink/60">
              Conference
            </label>
            <select
              id="reviewer-conference"
              value={conferenceId ?? ''}
              onChange={(e) => handleSwitchConference(e.target.value)}
              className="mt-1 w-full max-w-sm rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
            >
              {myConferences.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-ink/60">Loading…</p>
        ) : !conferenceId ? (
          <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
            You are not set up as a reviewer for any conference yet.
          </p>
        ) : open ? (
          <>
            <button
              type="button"
              onClick={() => {
                setOpen(null)
                setRefreshKey((k) => k + 1)
              }}
              className="mt-4 text-sm text-button underline"
            >
              ← Back to my assignments
            </button>
            <ReviewForm assignmentId={open.assignmentId} submissionId={open.submissionId} />
          </>
        ) : (
          <AssignmentsList conferenceId={conferenceId} onOpen={setOpen} refreshKey={refreshKey} />
        )}
      </main>
    </div>
  )
}
