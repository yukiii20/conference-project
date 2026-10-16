import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { formatKathmanduTime, kathmanduDateKey } from '../../../lib/datetime'
import { AttendanceDashboard } from '../../../components/attendance/AttendanceDashboard'
import { RecentCheckins } from '../../../components/attendance/RecentCheckins'
import { RegistrationsList } from '../../../components/attendance/RegistrationsList'

// Lazy for the same reason as the convenor Attendance tab — zxing only
// needs to load for someone actually on this screen.
const CheckInPanel = lazy(() => import('../../../components/attendance/CheckInPanel'))

type PublicSession = {
  id: string
  title: string
  session_type: string
  starts_at: string
  ends_at: string
  room: { name: string } | null
}

function TodaysProgramme({ conferenceId }: { conferenceId: string }) {
  const [sessions, setSessions] = useState<PublicSession[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ schedule: PublicSession[] }>(`/conferences/${conferenceId}/sessions/public`)
      .then((data) => {
        if (cancelled) return
        const today = kathmanduDateKey(new Date().toISOString())
        setSessions(data.schedule.filter((s) => kathmanduDateKey(s.starts_at) === today))
      })
      .catch(() => {
        if (!cancelled) setSessions([])
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  if (sessions === null) return <p className="mt-3 text-sm text-ink/60">Loading…</p>
  if (sessions.length === 0) return <p className="mt-3 text-sm text-ink/60">No published sessions today.</p>

  return (
    <ul className="mt-3 space-y-1.5">
      {sessions
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((s) => (
          <li key={s.id} className="rounded-md border border-line bg-white px-3 py-2 text-sm">
            <span className="font-medium text-ink">{formatKathmanduTime(s.starts_at)}</span> {s.title}
            {s.room ? <span className="text-ink/60"> · {s.room.name}</span> : null}
          </li>
        ))}
    </ul>
  )
}

export function StaffSection({ conferenceId }: { conferenceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="mt-6 max-w-5xl">
      <h2 className="text-lg font-medium text-ink">Check-in desk</h2>

      <div className="mt-4">
        <AttendanceDashboard conferenceId={conferenceId} refreshKey={refreshKey} />
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold text-ink">Check in an attendee</h3>
        <div className="mt-3">
          <Suspense fallback={<p className="text-sm text-ink/60">Loading…</p>}>
            <CheckInPanel conferenceId={conferenceId} onCheckedIn={() => setRefreshKey((k) => k + 1)} />
          </Suspense>
        </div>
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold text-ink">Recent check-ins</h3>
        <RecentCheckins conferenceId={conferenceId} refreshKey={refreshKey} />
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold text-ink">Today's programme</h3>
        <TodaysProgramme conferenceId={conferenceId} />
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold text-ink">Registrations</h3>
        <RegistrationsList conferenceId={conferenceId} readOnly />
      </div>
    </div>
  )
}
