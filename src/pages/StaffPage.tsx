import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { getRoleDefinition } from '../lib/roles'
import { PortalHeader } from '../components/PortalHeader'
import { AttendanceDashboard, CheckInPanel } from '../components/attendance/CheckInPanel'

type StaffConference = { id: string; name: string; slug: string }

export function StaffPage() {
  const [searchParams] = useSearchParams()
  const preselectedSlug = searchParams.get('conference')?.trim() || null
  const { roles } = useAuth()

  const [myConferences, setMyConferences] = useState<StaffConference[]>([])
  const [conferenceId, setConferenceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // The conference selector comes only from GET /api/auth/me (via the
  // shared auth context) — never from a client-side auth SDK session.
  useEffect(() => {
    const options: StaffConference[] = roles
      .filter((r) => r.role_code === 'staff' && r.conference_id)
      .map((r) => ({ id: r.conference_id as string, name: r.conference_name ?? '', slug: r.conference_slug ?? '' }))

    setMyConferences(options)
    const preselected = preselectedSlug ? options.find((c) => c.slug === preselectedSlug) : null
    setConferenceId((preselected ?? options[0])?.id ?? null)
    setLoading(false)
  }, [roles, preselectedSlug])

  return (
    <div className="min-h-screen bg-background text-ink">
      <PortalHeader roleLabel={getRoleDefinition('staff')?.label ?? 'Staff'} />

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Check-in</h1>

        {myConferences.length > 1 ? (
          <div className="mt-3">
            <label htmlFor="staff-conference" className="block text-xs font-medium text-ink/60">
              Conference
            </label>
            <select
              id="staff-conference"
              value={conferenceId ?? ''}
              onChange={(e) => {
                setConferenceId(e.target.value)
                setRefreshKey((k) => k + 1)
              }}
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
            You are not set up as staff for any conference yet.
          </p>
        ) : (
          <>
            <div className="mt-6">
              <AttendanceDashboard conferenceId={conferenceId} refreshKey={refreshKey} />
            </div>
            <div className="mt-6">
              <CheckInPanel conferenceId={conferenceId} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
