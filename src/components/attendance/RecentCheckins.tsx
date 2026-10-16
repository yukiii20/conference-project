import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'

type RecentCheckin = {
  id: string
  full_name: string
  registration_number: string
  method: 'qr' | 'manual'
  checked_in_at: string
}

/** The last 20 conference-wide check-ins, newest first — refetches whenever `refreshKey` changes (bumped by CheckInPanel on a successful check-in). */
export function RecentCheckins({ conferenceId, refreshKey }: { conferenceId: string; refreshKey: number }) {
  const [checkins, setCheckins] = useState<RecentCheckin[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ checkins: RecentCheckin[] }>(`/conferences/${conferenceId}/attendance/recent`)
      .then((data) => {
        if (!cancelled) setCheckins(data.checkins)
      })
      .catch(() => {
        if (!cancelled) setCheckins([])
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId, refreshKey])

  if (checkins === null) return <p className="mt-2 text-sm text-ink/60">Loading…</p>
  if (checkins.length === 0) return <p className="mt-2 text-sm text-ink/60">No check-ins yet.</p>

  return (
    <ul className="mt-2 space-y-1">
      {checkins.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm">
          <span>
            {c.full_name} <span className="text-ink/50">({c.registration_number})</span>
          </span>
          <span className="shrink-0 text-xs text-ink/50">
            {c.method === 'qr' ? 'QR' : 'Manual'} · {formatKathmandu(c.checked_in_at)}
          </span>
        </li>
      ))}
    </ul>
  )
}
