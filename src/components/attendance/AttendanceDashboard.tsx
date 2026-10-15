import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

export function AttendanceDashboard({ conferenceId, refreshKey }: { conferenceId: string; refreshKey: number }) {
  const [dashboard, setDashboard] = useState<{ registered: number; checked_in_today: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ registered: number; checked_in_today: number }>(`/conferences/${conferenceId}/attendance/dashboard`)
      .then((data) => {
        if (!cancelled) setDashboard(data)
      })
      .catch(() => {
        if (!cancelled) setDashboard(null)
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId, refreshKey])

  if (!dashboard) return null

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-line bg-white p-4">
        <p className="text-xs text-ink/60">Confirmed registrations</p>
        <p className="mt-1 text-2xl font-semibold text-ink">{dashboard.registered}</p>
      </div>
      <div className="rounded-lg border border-line bg-white p-4">
        <p className="text-xs text-ink/60">Checked in today</p>
        <p className="mt-1 text-2xl font-semibold text-ink">{dashboard.checked_in_today}</p>
      </div>
    </div>
  )
}
