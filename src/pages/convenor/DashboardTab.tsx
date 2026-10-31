import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Award,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  FileText,
  Ticket,
  Users,
} from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { PageHeader } from '../../components/ui/PageHeader'
import { Skeleton } from '../../components/ui/Spinner'
import { StatCard } from '../../components/ui/StatCard'
import { buttonClasses } from '../../components/ui/Button'
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
    <div className="rounded-xl border border-border-soft bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Setup checklist</h2>
        <span className="text-xs font-medium text-text-muted">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-gold transition-[width] duration-700" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <p className="mt-1 text-sm text-text-muted">
        {checklist.published
          ? "A few things are still worth finishing."
          : "Your conference isn't visible on the public home page yet — here's what's left."}
      </p>
      <ul className="mt-4 grid gap-1 md:grid-cols-2">
        {steps.map((step) => {
          const done = checklist[step.id]
          return (
            <li key={step.id}>
              <Link
                to={`${base}/${step.to}`}
                className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-page-bg ${done ? 'text-text-muted' : 'text-text'}`}
              >
                <Icon icon={done ? CheckCircle2 : Circle} size={18} className={`mt-px shrink-0 ${done ? 'text-success' : 'text-border-strong'}`} />
                <span className="min-w-0 flex-1">
                  <span className={done ? 'line-through decoration-text-muted/50' : 'font-medium'}>{step.label}</span>
                  {!done ? <span className="block text-xs text-text-muted">{step.hint}</span> : null}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AttentionRow({ label, count, to }: { label: string; count: number; to: string }) {
  if (count <= 0) return null
  return (
    <Link
      to={to}
      className="group flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-page-bg/50 px-3.5 py-2.5 text-sm transition-colors hover:border-border hover:bg-surface"
    >
      <span className="text-text">{label}</span>
      <span className="flex items-center gap-2">
        <Badge tone="warning">{count}</Badge>
        <Icon icon={ChevronRight} size={16} className="text-text-muted transition-transform group-hover:translate-x-0.5" />
      </span>
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
      <div className="space-y-8" aria-busy="true">
        <Skeleton className="h-16 w-72" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
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
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle="An overview of this conference's submissions, reviews and registrations." />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Submissions" value={totalSubmissions} to={`${base}/papers/submissions`} icon={FileText} />
        <StatCard label="Reviews pending" value={data.reviews.assigned} to={`${base}/papers/reviews`} icon={Clock} />
        <StatCard label="Reviews done" value={data.reviews.completed} to={`${base}/papers/reviews`} icon={CheckCircle2} />
        <StatCard label="Accepted papers" value={data.accepted_papers} to={`${base}/papers/submissions`} icon={Award} />
        <StatCard label="Members" value={totalMembers} to={`${base}/people/members`} icon={Users} />
        <StatCard label="Registrations" value={data.registrations} to={`${base}/event/attendance`} icon={Ticket} />
      </div>

      <SubmissionPipeline byStatus={data.submissions_by_status} total={totalSubmissions} reviews={data.reviews} />

      <SetupChecklistCard checklist={data.setup_checklist} base={base} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border-soft bg-surface p-5 shadow-card sm:p-6">
          <h2 className="text-sm font-semibold text-text">Needs your attention</h2>
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
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-page-bg/50 px-3.5 py-2.5 text-sm transition-colors hover:border-border hover:bg-surface"
                >
                  <span className="text-text">
                    {attention.deadline_within_week.deadline_type.replace(/_/g, ' ')} closes within a week
                  </span>
                  <Badge tone="warning">{attention.deadline_within_week.days}d</Badge>
                </Link>
              ) : null}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border-soft bg-surface p-5 shadow-card sm:p-6">
          <h2 className="text-sm font-semibold text-text">Submissions per track</h2>
          {data.submissions_per_track.length === 0 ? (
            <div className="mt-2 flex flex-col items-center gap-3 py-6 text-center">
              <Icon icon={FileText} size={28} className="text-text-muted" />
              <p className="text-sm text-text-muted">No tracks yet.</p>
              <Link
                to={`${base}/schedule-basics/tracks`}
                className={buttonClasses('primary', 'md')}
              >
                Add tracks
              </Link>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {data.submissions_per_track.map((t) => (
                <div key={t.track_name} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 truncate text-sm text-text-muted" title={t.track_name}>{t.track_name}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    {t.count > 0 ? (
                      <div
                        className="h-full rounded-full bg-button transition-[width] duration-700"
                        style={{ width: `${(t.count / maxTrackCount) * 100}%` }}
                      />
                    ) : null}
                  </div>
                  <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums text-text">{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const PIPELINE: Array<{ status: string; label: string; color: string }> = [
  { status: 'draft', label: 'Draft', color: 'bg-border-strong' },
  { status: 'submitted', label: 'Submitted', color: 'bg-indigo' },
  { status: 'under_review', label: 'Under review', color: 'bg-button-active' },
  { status: 'revision_required', label: 'Revision', color: 'bg-gold' },
  { status: 'accepted', label: 'Accepted', color: 'bg-success' },
  { status: 'rejected', label: 'Rejected', color: 'bg-danger/70' },
]

/** One stacked bar of every submission by status, plus review completion - both from the dashboard payload. */
function SubmissionPipeline({
  byStatus,
  total,
  reviews,
}: {
  byStatus: Record<string, number>
  total: number
  reviews: { assigned: number; completed: number }
}) {
  const known = new Set(PIPELINE.map((p) => p.status))
  const other = Object.entries(byStatus)
    .filter(([k]) => !known.has(k))
    .reduce((a, [, v]) => a + v, 0)
  const segments = [...PIPELINE.map((p) => ({ ...p, count: byStatus[p.status] ?? 0 })), { status: 'other', label: 'Other', color: 'bg-surface-muted', count: other }].filter(
    (s) => s.count > 0,
  )
  const reviewTotal = reviews.assigned + reviews.completed
  const reviewPct = reviewTotal === 0 ? 0 : Math.round((reviews.completed / reviewTotal) * 100)

  return (
    <div className="grid gap-6 rounded-xl border border-border-soft bg-surface p-5 shadow-card sm:p-6 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-text">Submission pipeline</h2>
        {total === 0 ? (
          <p className="mt-3 text-sm text-text-muted">No submissions yet.</p>
        ) : (
          <>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(', ')}>
              {segments.map((s) => (
                <div key={s.status} className={`${s.color} h-full first:rounded-l-full last:rounded-r-full`} style={{ width: `${(s.count / total) * 100}%` }} />
              ))}
            </div>
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {segments.map((s) => (
                <li key={s.status} className="flex items-center gap-2 text-text-muted">
                  <span className={`h-2.5 w-2.5 rounded-sm ${s.color}`} aria-hidden="true" />
                  {s.label}
                  <span className="font-medium tabular-nums text-text">{s.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="flex items-center gap-4 border-t border-border-soft pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <ProgressRing pct={reviewPct} />
        <div>
          <p className="text-sm font-semibold text-text">Reviews completed</p>
          <p className="mt-0.5 text-sm text-text-muted">
            {reviews.completed} of {reviewTotal} assigned
          </p>
        </div>
      </div>
    </div>
  )
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0" aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-surface-muted" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
        transform="rotate(-90 32 32)"
        className="stroke-button transition-[stroke-dashoffset] duration-700"
      />
      <text x="32" y="36.5" textAnchor="middle" className="fill-brand text-[13px] font-semibold">
        {pct}%
      </text>
    </svg>
  )
}
