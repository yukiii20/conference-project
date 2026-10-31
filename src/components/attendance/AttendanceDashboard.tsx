import { useEffect, useState } from 'react'
import { Ticket, UserCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { StatCard } from '../ui'

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
    <div className="grid grid-cols-2 gap-4">
      <StatCard label="Confirmed registrations" value={dashboard.registered} icon={Ticket} />
      <StatCard label="Checked in today" value={dashboard.checked_in_today} icon={UserCheck} />
    </div>
  )
}
