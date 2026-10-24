import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Award,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { PageHeader } from '../../components/ui/PageHeader'
import { Spinner } from '../../components/ui/Spinner'
import { ErrorState } from '../../components/ui/EmptyState'
import { Badge } from '../../components/ui/Badge'
import { Icon } from '../../components/ui/Icon'

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
    pending_registrations: number
    deadline_within_week: { deadline_type: string; at: string; days: number } | null
  }
  setup_checklist: {
    details_done: boolean
    logo_done: boolean
    key_dates_done: boolean
    tracks_done: boolean
    registration_categories_done: boolean
    certificate_template_done: boolean
    published: boolean
  }
}

type ChecklistStep = { id: keyof Dashboard['setup_checklist']; label: string; hint: string; to: string }

const CHECKLIST_STEPS: ChecklistStep[] = [
  { id: 'details_done', label: 'Fill in conference details', hint: 'Name, description and dates visitors see.', to: 'setup/details' },
  { id: 'logo_done', label: 'Add a logo', hint: 'Shown on the public page and in emails.', to: 'setup/branding' },
  { id: 'key_dates_done', label: 'Set key dates', hint: 'When registration and submission open and close.', to: 'schedule-basics/dates' },
  { id: 'tracks_done', label: 'Add tracks', hint: 'Authors pick one when they submit a paper.', to: 'schedule-basics/tracks' },
  {
    id: 'registration_categories_done',
    label: 'Add registration categories',
    hint: 'E.g. Student, Regular — attendees choose one when they register.',
    to: 'event/attendance',
  },
  {
    id: 'certificate_template_done',
    label: 'Design a certificate template',
    hint: 'Needed before you can issue participation certificates.',
    to: 'event/certificates',
  },
  { id: 'published', label: 'Publish the conference', hint: "Until then, it's not visible on the public home page.", to: 'setup/details' },
]

function SetupChecklistCard({ checklist, base }: { checklist: Dashboard['setup_checklist']; base: string }) {
  const steps = CHECKLIST_STEPS
  const doneCount = steps.filter((s) => checklist[s.id]).length
  if (doneCount === steps.length) return null // every step done - no need to keep showing this

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Setup checklist</h2>
        <span className="text-xs text-text-muted">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        {checklist.published
          ? "A few things are still worth finishing."
          : "Your conference isn't visible on the public home page yet — here's what's left."}
      </p>
      <ul className="mt-3 space-y-1.5">
        {steps.map((step) => {
          const done = checklist[step.id]
          return (
            <li key={step.id}>
              <Link
                to={`${base}/${step.to}`}
                className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted ${done ? 'text-text-muted line-through' : 'text-text'}`}
              >
                <Icon icon={done ? CheckCircle2 : Circle} size={18} className={done ? 'text-success' : 'text-text-muted'} />
                <span className="flex-1">{step.label}</span>
                {!done ? <span className="hidden text-xs text-text-muted sm:inline">{step.hint}</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Card({ label, value, to, icon }: { label: string; value: number | string; to?: string; icon: LucideIcon }) {
  const content = (
    <div className="flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
        <Icon icon={icon} className="text-brand/60" />
      </div>
      <p className="text-2xl font-semibold text-brand">{value}</p>
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
    attention.pending_registrations > 0 ||
    Boolean(attention.deadline_within_week)

  return (
    <div className="mt-6 space-y-8">
      <PageHeader title="Dashboard" subtitle="An overview of this conference's submissions, reviews and registrations." />

      <SetupChecklistCard checklist={data.setup_checklist} base={base} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <Card label="Submissions" value={totalSubmissions} to={`${base}/papers/submissions`} icon={FileText} />
        <Card label="Reviews pending" value={data.reviews.assigned} to={`${base}/papers/reviews`} icon={Clock} />
        <Card label="Reviews done" value={data.reviews.completed} to={`${base}/papers/reviews`} icon={CheckCircle2} />
        <Card label="Accepted papers" value={data.accepted_papers} to={`${base}/papers/submissions`} icon={Award} />
        <Card label="Members" value={totalMembers} to={`${base}/people/members`} icon={Users} />
        <Card label="Registrations" value={data.registrations} to={`${base}/event/attendance`} icon={Ticket} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Needs your attention</h2>
          {data.next_key_date ? (
            <p className="mt-2 text-sm text-text-muted">
              Next key date: <span className="font-medium text-text">{data.next_key_date.deadline_type.replace(/_/g, ' ')}</span>{' '}
              — {formatKathmandu(data.next_key_date.at)} (
              {data.next_key_date.days <= 0
                ? 'today or past'
                : `${data.next_key_date.days} day${data.next_key_date.days === 1 ? '' : 's'}`}
              )
            </p>
          ) : null}
          {!hasAttention ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-text-muted">
              <Icon icon={CheckCircle2} className="text-success" />
              Nothing needs your attention right now.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <AttentionRow label="Pending role requests" count={pendingRoleRequests} to={`${base}/people/requests`} />
              <AttentionRow
                label="Pending registrations (payment to confirm)"
                count={attention.pending_registrations}
                to={`${base}/event/attendance?status=pending`}
              />
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

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Submissions per track</h2>
          {data.submissions_per_track.length === 0 ? (
            <div className="mt-2 flex flex-col items-center gap-3 py-6 text-center">
              <Icon icon={FileText} size={28} className="text-text-muted" />
              <p className="text-sm text-text-muted">No tracks yet.</p>
              <Link
                to={`${base}/schedule-basics/tracks`}
                className="inline-flex min-h-10 items-center rounded-md bg-button px-4 text-sm font-medium text-white hover:bg-button-hover"
              >
                Add tracks
              </Link>
            </div>
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
    </div>
  )
}
