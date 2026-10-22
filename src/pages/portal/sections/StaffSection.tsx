import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { formatKathmanduTime, kathmanduDateKey } from '../../../lib/datetime'
import { AttendanceDashboard } from '../../../components/attendance/AttendanceDashboard'
import { RecentCheckins } from '../../../components/attendance/RecentCheckins'
import { RegistrationsList } from '../../../components/attendance/RegistrationsList'
import { EmptyState, PageHeader, SkeletonText } from '../../../components/ui'

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

  if (sessions === null) return <SkeletonText lines={2} className="mt-3" />
  if (sessions.length === 0) return <EmptyState title="No published sessions today." />

  return (
    <ul className="mt-3 space-y-1.5">
      {sessions
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((s) => (
          <li key={s.id} className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
            <span className="font-medium text-text">{formatKathmanduTime(s.starts_at)}</span> {s.title}
            {s.room ? <span className="text-text-muted"> · {s.room.name}</span> : null}
          </li>
        ))}
    </ul>
  )
}

export function StaffSection({ conferenceId }: { conferenceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="mt-6 max-w-5xl">
      <PageHeader title="Check-in desk" />

      <div className="mt-4">
        <AttendanceDashboard conferenceId={conferenceId} refreshKey={refreshKey} />
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold text-text">Check in an attendee</h3>
        <div className="mt-3">
          <Suspense fallback={<SkeletonText lines={3} />}>
            <CheckInPanel conferenceId={conferenceId} onCheckedIn={() => setRefreshKey((k) => k + 1)} />
          </Suspense>
        </div>
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold text-text">Recent check-ins</h3>
        <RecentCheckins conferenceId={conferenceId} refreshKey={refreshKey} />
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold text-text">Today's programme</h3>
        <TodaysProgramme conferenceId={conferenceId} />
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold text-text">Registrations</h3>
        <RegistrationsList conferenceId={conferenceId} readOnly />
      </div>
    </div>
  )
}
