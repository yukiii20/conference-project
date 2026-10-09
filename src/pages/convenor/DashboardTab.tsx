import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'

type Dashboard = {
  submissions_by_status: Record<string, number>
  reviews: { assigned: number; completed: number }
  accepted_papers: number
  members_by_role: Record<string, number>
  registrations: number
  next_key_date: { deadline_type: string; at: string; days: number } | null
  submissions_per_track: Array<{ track_name: string; count: number }>
  needs_attention: {
    pending_role_requests: number
    submitted_no_reviewer: number
    overdue_reviews: number
    awaiting_decision: number
    deadline_within_week: { deadline_type: string; at: string; days: number } | null
  }
}

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink/50">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
    </div>
  )
}

function AttentionRow({ label, count, to }: { label: string; count: number; to: string }) {
  if (count <= 0) return null
  return (
    <Link to={to} className="flex items-center justify-between rounded-md border border-line bg-white px-3 py-2 text-sm hover:bg-background">
      <span className="text-ink/80">{label}</span>
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{count}</span>
    </Link>
  )
}

export function DashboardTab({ conferenceId, base }: { conferenceId: string; base: string }) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<Dashboard>(`/conferences/${conferenceId}/dashboard`)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  if (loading) return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  if (error || !data) return <p className="mt-6 text-sm text-red-600">{error ?? 'Could not load the dashboard.'}</p>

  const totalSubmissions = Object.values(data.submissions_by_status).reduce((a, b) => a + b, 0)
  const totalMembers = Object.values(data.members_by_role).reduce((a, b) => a + b, 0)
  const maxTrackCount = Math.max(1, ...data.submissions_per_track.map((t) => t.count))
  const attention = data.needs_attention
  const hasAttention =
    attention.pending_role_requests > 0 ||
    attention.submitted_no_reviewer > 0 ||
    attention.overdue_reviews > 0 ||
    attention.awaiting_decision > 0 ||
    Boolean(attention.deadline_within_week)

  return (
    <div className="mt-6 space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Submissions" value={totalSubmissions} />
        <Card label="Reviews assigned" value={data.reviews.assigned} />
        <Card label="Reviews done" value={data.reviews.completed} />
        <Card label="Accepted papers" value={data.accepted_papers} />
        <Card label="Members" value={totalMembers} />
        <Card label="Registrations" value={data.registrations} />
      </div>

      {data.next_key_date ? (
        <p className="text-sm text-ink/70">
          Next key date: <span className="font-medium text-ink">{data.next_key_date.deadline_type.replace(/_/g, ' ')}</span> —{' '}
          {formatKathmandu(data.next_key_date.at)} (
          {data.next_key_date.days <= 0 ? 'today or past' : `${data.next_key_date.days} day${data.next_key_date.days === 1 ? '' : 's'}`})
        </p>
      ) : null}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Needs your attention</h2>
        {!hasAttention ? (
          <p className="mt-2 text-sm text-ink/60">Nothing needs your attention right now.</p>
        ) : (
          <div className="mt-2 space-y-2">
            <AttentionRow label="Pending role requests" count={attention.pending_role_requests} to={`${base}/people/requests`} />
            <AttentionRow label="Submitted papers with no reviewer" count={attention.submitted_no_reviewer} to={`${base}/papers/submissions`} />
            <AttentionRow label="Overdue reviews" count={attention.overdue_reviews} to={`${base}/papers/reviews`} />
            <AttentionRow label="Papers awaiting a decision" count={attention.awaiting_decision} to={`${base}/papers/reviews`} />
            {attention.deadline_within_week ? (
              <Link to={`${base}/schedule-basics/dates`} className="flex items-center justify-between rounded-md border border-line bg-white px-3 py-2 text-sm hover:bg-background">
                <span className="text-ink/80">
                  {attention.deadline_within_week.deadline_type.replace(/_/g, ' ')} closes within a week
                </span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {attention.deadline_within_week.days}d
                </span>
              </Link>
            ) : null}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Submissions per track</h2>
        {data.submissions_per_track.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">No tracks yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {data.submissions_per_track.map((t) => (
              <div key={t.track_name} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-ink/70">{t.track_name}</span>
                <div className="h-3 flex-1 rounded-full bg-background">
                  <div
                    className="h-3 rounded-full bg-button"
                    style={{ width: `${(t.count / maxTrackCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm text-ink/70">{t.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
