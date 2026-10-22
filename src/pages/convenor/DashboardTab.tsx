import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { PageHeader } from '../../components/ui/PageHeader'
import { Spinner } from '../../components/ui/Spinner'
import { ErrorState } from '../../components/ui/EmptyState'
import { Badge } from '../../components/ui/Badge'

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

function Card({ label, value, to }: { label: string; value: number | string; to?: string }) {
  const content = (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-brand">{value}</p>
    </div>
  )
  if (!to) return content
  return (
    <Link to={to} className="block h-full transition-shadow hover:shadow-md">
      {content}
    </Link>
  )
}

function AttentionRow({ label, count, to }: { label: string; count: number; to: string }) {
  if (count <= 0) return null
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-muted"
    >
      <span className="text-text/80">{label}</span>
      <Badge tone="warning">{count}</Badge>
    </Link>
  )
}

export function DashboardTab({ conferenceId, base, isManager }: { conferenceId: string; base: string; isManager?: boolean }) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
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

  if (loading) {
    return (
      <div className="mt-10 flex justify-center">
        <Spinner size="lg" />
      </div>
    )
  }
  if (error || !data) {
    return <ErrorState message={error ?? 'Could not load the dashboard.'} onRetry={() => setLoading(true)} />
  }

  const totalSubmissions = Object.values(data.submissions_by_status).reduce((a, b) => a + b, 0)
  const totalMembers = Object.values(data.members_by_role).reduce((a, b) => a + b, 0)
  const maxTrackCount = Math.max(1, ...data.submissions_per_track.map((t) => t.count))
  const attention = data.needs_attention
  // Managers hold every permission except members.manage, so they can't act on
  // role requests - don't surface an attention item that would 403 if clicked.
  const pendingRoleRequests = isManager ? 0 : attention.pending_role_requests
  const hasAttention =
    pendingRoleRequests > 0 ||
    attention.submitted_no_reviewer > 0 ||
    attention.overdue_reviews > 0 ||
    attention.awaiting_decision > 0 ||
    Boolean(attention.deadline_within_week)

  return (
    <div className="mt-6 space-y-8">
      <PageHeader title="Dashboard" subtitle="An overview of this conference's submissions, reviews and registrations." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Submissions" value={totalSubmissions} to={`${base}/papers/submissions`} />
        <Card label="Reviews pending" value={data.reviews.assigned} to={`${base}/papers/reviews`} />
        <Card label="Reviews done" value={data.reviews.completed} to={`${base}/papers/reviews`} />
        <Card label="Accepted papers" value={data.accepted_papers} to={`${base}/papers/submissions`} />
        <Card label="Members" value={totalMembers} to={`${base}/people/members`} />
        <Card label="Registrations" value={data.registrations} to={`${base}/event/attendance`} />
      </div>

      {data.next_key_date ? (
        <p className="text-sm text-text-muted">
          Next key date: <span className="font-medium text-text">{data.next_key_date.deadline_type.replace(/_/g, ' ')}</span> —{' '}
          {formatKathmandu(data.next_key_date.at)} (
          {data.next_key_date.days <= 0 ? 'today or past' : `${data.next_key_date.days} day${data.next_key_date.days === 1 ? '' : 's'}`})
        </p>
      ) : null}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Needs your attention</h2>
        {!hasAttention ? (
          <p className="mt-2 text-sm text-text-muted">Nothing needs your attention right now.</p>
        ) : (
          <div className="mt-2 space-y-2">
            <AttentionRow label="Pending role requests" count={pendingRoleRequests} to={`${base}/people/requests`} />
            <AttentionRow label="Submitted papers with no reviewer" count={attention.submitted_no_reviewer} to={`${base}/papers/submissions`} />
            <AttentionRow label="Overdue reviews" count={attention.overdue_reviews} to={`${base}/papers/reviews`} />
            <AttentionRow label="Papers awaiting a decision" count={attention.awaiting_decision} to={`${base}/papers/reviews`} />
            {attention.deadline_within_week ? (
              <Link
                to={`${base}/schedule-basics/dates`}
                className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-muted"
              >
                <span className="text-text/80">
                  {attention.deadline_within_week.deadline_type.replace(/_/g, ' ')} closes within a week
                </span>
                <Badge tone="warning">{attention.deadline_within_week.days}d</Badge>
              </Link>
            ) : null}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Submissions per track</h2>
        {data.submissions_per_track.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No tracks yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {data.submissions_per_track.map((t) => (
              <div key={t.track_name} className="flex h-6 items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-text-muted">{t.track_name}</span>
                <div className="h-3 flex-1 rounded-full bg-surface-muted">
                  {t.count > 0 ? (
                    <div
                      className="h-3 rounded-full bg-brand"
                      style={{ width: `${(t.count / maxTrackCount) * 100}%` }}
                    />
                  ) : null}
                </div>
                <span className="w-8 shrink-0 text-right text-sm text-text-muted">{t.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
