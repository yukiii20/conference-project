import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  FileText,
  History,
  Mail,
  Megaphone,
  QrCode,
  Shuffle,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/authContext'
import { formatKathmandu, formatKathmanduTime } from '../../lib/datetime'
import { humanizeAuditAction } from '../../lib/humanize'
import { relativeTime, sumLastDays } from '../../lib/relativeTime'
import { DEADLINE_LABELS } from '../conference/types'
import { Skeleton } from '../../components/ui/Spinner'
import { ErrorState } from '../../components/ui/EmptyState'
import { Badge } from '../../components/ui/Badge'
import { Icon } from '../../components/ui/Icon'
import type { ActivityEntry, ConvenorAnalytics, Dashboard, DeadlineRow, Room, SessionRow } from './dashboard/types'

const DashboardCharts = lazy(() => import('./dashboard/DashboardCharts'))

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

/** Optional data: each source loads on its own, and a section whose request fails (e.g. a manager without audit.read) simply isn't shown. */
type Extras = {
  analytics: ConvenorAnalytics | null
  deadlines: DeadlineRow[] | null
  sessions: SessionRow[] | null
  rooms: Room[]
  activity: ActivityEntry[] | null
}

const NO_EXTRAS: Extras = { analytics: null, deadlines: null, sessions: null, rooms: [], activity: null }

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kathmandu' })
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardTab({
  conferenceId,
  base,
  isManager,
  conferenceName: conferenceNameProp,
}: {
  conferenceId: string
  base: string
  isManager?: boolean
  /** Shown as the page title; ConvenorPage knows it in every mode (including admin view-as). */
  conferenceName?: string
}) {
  const { user, roles } = useAuth()
  const [data, setData] = useState<Dashboard | null>(null)
  const [extras, setExtras] = useState<Extras>(NO_EXTRAS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const conferenceName = conferenceNameProp || roles.find((r) => r.conference_id === conferenceId)?.conference_name || null
  const firstName = user?.full_name?.trim().split(/\s+/)[0] ?? ''

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setExtras(NO_EXTRAS)

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

    const base = `/conferences/${conferenceId}`
    const optional = <T,>(promise: Promise<T>) => promise.catch(() => null)
    Promise.all([
      optional(api.get<ConvenorAnalytics>(`${base}/analytics`, { from: isoDay(-29), to: isoDay(0) })),
      optional(api.get<{ deadlines: DeadlineRow[] }>(`${base}/deadlines`)),
      optional(api.get<{ sessions: SessionRow[] }>(`${base}/sessions`)),
      optional(api.get<{ rooms: Room[] }>(`${base}/rooms`)),
      // audit.read is convenor-only; don't ask on a manager's behalf just to be refused.
      isManager ? Promise.resolve(null) : optional(api.get<{ entries: ActivityEntry[] }>(`${base}/activity-log`, { page: '1' })),
    ]).then(([analytics, deadlines, sessions, rooms, activity]) => {
      if (cancelled) return
      setExtras({
        analytics,
        deadlines: deadlines?.deadlines ?? null,
        sessions: sessions?.sessions ?? null,
        rooms: rooms?.rooms ?? [],
        activity: activity?.entries ?? null,
      })
    })

    return () => {
      cancelled = true
    }
  }, [conferenceId, isManager, reloadKey])

  if (loading) return <DashboardSkeleton />
  if (error || !data) return <ErrorState message={error ?? 'Could not load the dashboard.'} onRetry={reload} />

  const totalSubmissions = Object.values(data.submissions_by_status).reduce((a, b) => a + b, 0)
  const totalMembers = Object.values(data.members_by_role).reduce((a, b) => a + b, 0)
  const reviewTotal = data.reviews.assigned + data.reviews.completed
  const reviewPct = reviewTotal === 0 ? null : Math.round((data.reviews.completed / reviewTotal) * 100)
  const analytics = extras.analytics
  const newSubmissions7 = analytics ? sumLastDays(analytics.submissions_per_day, 7) : null
  const newRegistrations7 = analytics ? sumLastDays(analytics.registrations_over_time, 7) : null
  const checklistDone = CHECKLIST_STEPS.filter((s) => data.setup_checklist[s.id]).length

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div className="min-w-0">
          <p className="text-sm text-text-muted">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-brand sm:text-[1.75rem] sm:leading-tight">
            {conferenceName ?? 'Dashboard'}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            {data.setup_checklist.published ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Not published</Badge>}
            {data.next_key_date ? (
              <span>
                Next: <span className="font-medium text-text">{DEADLINE_LABELS[data.next_key_date.deadline_type] ?? data.next_key_date.deadline_type.replace(/_/g, ' ')}</span>{' '}
                {relativeTime(data.next_key_date.at)}
              </span>
            ) : null}
          </div>
        </div>
        <Link
          to={`${base}/communication/announcements`}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-button px-4 text-sm font-medium text-white shadow-[0_1px_2px_rgb(16_28_50/0.12)] transition-colors hover:bg-button-hover"
        >
          <Megaphone size={16} aria-hidden="true" />
          Post announcement
        </Link>
      </header>

      {!data.setup_checklist.published || checklistDone < CHECKLIST_STEPS.length ? (
        <SetupChecklist checklist={data.setup_checklist} base={base} done={checklistDone} />
      ) : null}

      <section aria-label="Key figures" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border-soft bg-border-soft shadow-card lg:grid-cols-4">
        <Kpi
          label="Submissions"
          value={totalSubmissions}
          to={`${base}/papers/submissions`}
          detail={newSubmissions7 === null ? `${data.accepted_papers} accepted` : `+${newSubmissions7} in the last 7 days`}
          series={analytics?.submissions_per_day}
        />
        <Kpi
          label="Registrations"
          value={data.registrations}
          to={`${base}/event/attendance`}
          detail={
            newRegistrations7 === null
              ? data.needs_attention.pending_registrations > 0
                ? `${data.needs_attention.pending_registrations} awaiting payment`
                : 'All confirmed'
              : `+${newRegistrations7} in the last 7 days`
          }
          series={analytics?.registrations_over_time}
        />
        <Kpi
          label="Reviews completed"
          value={reviewPct === null ? '—' : `${reviewPct}%`}
          to={`${base}/papers/reviews`}
          detail={reviewTotal === 0 ? 'No reviews assigned yet' : `${data.reviews.completed} of ${reviewTotal} assigned`}
          progress={reviewPct}
        />
        <Kpi
          label="Accepted papers"
          value={data.accepted_papers}
          to={`${base}/papers/reviews`}
          detail={
            analytics && analytics.acceptance_rate.denominator > 0
              ? `${Math.round(analytics.acceptance_rate.rate * 100)}% acceptance rate`
              : `${totalMembers} people in the team`
          }
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <PendingActions data={data} base={base} isManager={Boolean(isManager)} />
          <SubmissionPipeline byStatus={data.submissions_by_status} total={totalSubmissions} />
          {analytics ? (
            <Suspense fallback={<Skeleton className="h-72 rounded-xl" />}>
              <DashboardCharts analytics={analytics} />
            </Suspense>
          ) : null}
          <DistributionCards data={data} analytics={analytics} base={base} />
        </div>

        <aside className="min-w-0 space-y-6" aria-label="Schedule and activity">
          <QuickActions base={base} />
          {extras.deadlines ? <UpcomingDeadlines deadlines={extras.deadlines} base={base} /> : null}
          {extras.sessions ? <UpcomingSessions sessions={extras.sessions} rooms={extras.rooms} base={base} /> : null}
          {extras.activity ? <RecentActivity entries={extras.activity} base={base} /> : null}
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Panel({ title, icon, action, children }: { title: string; icon?: LucideIcon; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border-soft bg-surface shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          {icon ? <Icon icon={icon} size={16} className="text-text-muted" /> : null}
          {title}
        </h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-button hover:underline">
      {children}
      <ArrowRight size={13} aria-hidden="true" />
    </Link>
  )
}

function Kpi({
  label,
  value,
  detail,
  to,
  series,
  progress,
}: {
  label: string
  value: number | string
  detail: string
  to: string
  series?: Array<{ count: number }>
  progress?: number | null
}) {
  return (
    <Link to={to} className="group relative flex min-h-[8.5rem] flex-col bg-surface p-5 transition-colors hover:bg-page-bg/60 focus-visible:z-10">
      <span className="text-sm font-medium text-text-muted">{label}</span>
      <span className="mt-2 font-display text-[2rem] font-semibold leading-none tracking-tight tabular-nums text-brand">{value}</span>
      <span className="mt-auto pt-3 text-xs text-text-muted">{detail}</span>
      {series && series.some((p) => p.count > 0) ? <Sparkline series={series} /> : null}
      {progress !== undefined && progress !== null ? (
        <span className="absolute inset-x-5 bottom-0 h-1 overflow-hidden rounded-t-full bg-surface-muted" aria-hidden="true">
          <span className="block h-full bg-button transition-[width] duration-700" style={{ width: `${progress}%` }} />
        </span>
      ) : null}
      <ChevronRight size={16} aria-hidden="true" className="absolute right-4 top-5 text-text-muted/0 transition-colors group-hover:text-text-muted" />
    </Link>
  )
}

/** Decorative 30-day trend under a KPI - the number and its detail line carry the information. */
function Sparkline({ series }: { series: Array<{ count: number }> }) {
  const w = 96
  const h = 28
  const max = Math.max(1, ...series.map((p) => p.count))
  const step = series.length > 1 ? w / (series.length - 1) : w
  const points = series.map((p, i) => `${(i * step).toFixed(1)},${(h - 2 - (p.count / max) * (h - 4)).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="absolute bottom-4 right-4 max-sm:hidden" aria-hidden="true">
      <polyline points={`0,${h} ${points} ${w},${h}`} fill="#4f5fc0" fillOpacity="0.08" stroke="none" />
      <polyline points={points} fill="none" stroke="#4f5fc0" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function SetupChecklist({ checklist, base, done }: { checklist: Dashboard['setup_checklist']; base: string; done: number }) {
  const total = CHECKLIST_STEPS.length
  const next = CHECKLIST_STEPS.find((s) => !checklist[s.id])
  return (
    <section className="overflow-hidden rounded-xl border border-gold/50 bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gold-soft/60 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">Finish setting up your conference</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            {checklist.published ? 'Published — a few things are still worth finishing.' : "Not visible on the public home page until it's published."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium tabular-nums text-gold-ink">
            {done} / {total}
          </span>
          <span className="h-1.5 w-32 overflow-hidden rounded-full bg-surface" aria-hidden="true">
            <span className="block h-full rounded-full bg-gold transition-[width] duration-700" style={{ width: `${(done / total) * 100}%` }} />
          </span>
          {next ? (
            <Link to={`${base}/${next.to}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text hover:border-border-strong">
              Next step
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>
      <ul className="grid gap-x-4 px-3 py-2 sm:grid-cols-2 xl:grid-cols-4">
        {CHECKLIST_STEPS.map((step) => {
          const isDone = checklist[step.id]
          return (
            <li key={step.id}>
              <Link
                to={`${base}/${step.to}`}
                title={isDone ? undefined : step.hint}
                className={`flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-page-bg ${isDone ? 'text-text-muted' : 'text-text'}`}
              >
                <Icon icon={isDone ? CheckCircle2 : Circle} size={17} className={`shrink-0 ${isDone ? 'text-success' : 'text-border-strong'}`} />
                <span className={isDone ? 'line-through decoration-text-muted/40' : 'font-medium'}>{step.label}</span>
                <span className="sr-only">{isDone ? '(done)' : '(to do)'}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PendingActions({ data, base, isManager }: { data: Dashboard; base: string; isManager: boolean }) {
  const a = data.needs_attention
  // Managers can't act on role requests (members.manage) - don't offer a link that would 403.
  const items: Array<{ label: string; count: number; to: string; icon: LucideIcon; urgent?: boolean }> = [
    { label: 'Overdue reviews', count: a.overdue_reviews, to: `${base}/papers/reviews`, icon: CalendarClock, urgent: true },
    { label: 'Submitted papers with no reviewer', count: a.submitted_no_reviewer, to: `${base}/papers/auto-assign`, icon: Shuffle },
    { label: 'Papers awaiting a decision', count: a.awaiting_decision, to: `${base}/papers/reviews`, icon: ClipboardCheck },
    { label: 'Registrations awaiting payment confirmation', count: a.pending_registrations, to: `${base}/event/attendance?status=pending`, icon: Ticket },
    { label: 'Pending role requests', count: isManager ? 0 : a.pending_role_requests, to: `${base}/people/requests`, icon: Users },
  ].filter((i) => i.count > 0)
  const deadline = a.deadline_within_week

  return (
    <Panel title="Pending actions" icon={CheckCircle2}>
      {items.length === 0 && !deadline ? (
        <p className="flex items-center gap-2 py-2 text-sm text-text-muted">
          <Icon icon={CheckCircle2} className="text-success" />
          You're all caught up — nothing needs your attention right now.
        </p>
      ) : (
        <ul className="-mx-2 divide-y divide-border-soft">
          {deadline ? (
            <li>
              <Link to={`${base}/schedule-basics/dates`} className="group flex min-h-12 items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-page-bg">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-soft text-gold-ink">
                  <CalendarDays size={16} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-sm text-text">
                  {DEADLINE_LABELS[deadline.deadline_type] ?? deadline.deadline_type.replace(/_/g, ' ')} closes {relativeTime(deadline.at)}
                </span>
                <Badge tone="warning">{deadline.days <= 0 ? 'Today' : `${deadline.days}d`}</Badge>
                <ChevronRight size={16} aria-hidden="true" className="text-text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ) : null}
          {items.map((item) => (
            <li key={item.label}>
              <Link to={item.to} className="group flex min-h-12 items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-page-bg">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.urgent ? 'bg-danger/10 text-danger' : 'bg-indigo-soft text-button'}`}
                >
                  <Icon icon={item.icon} size={16} />
                </span>
                <span className="min-w-0 flex-1 text-sm text-text">{item.label}</span>
                <span className="text-sm font-semibold tabular-nums text-text">{item.count}</span>
                <ChevronRight size={16} aria-hidden="true" className="text-text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
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

/** Every submission by status as one segmented bar, legend always shown (identity is never colour-alone). */
function SubmissionPipeline({ byStatus, total }: { byStatus: Record<string, number>; total: number }) {
  const known = new Set(PIPELINE.map((p) => p.status))
  const other = Object.entries(byStatus)
    .filter(([k]) => !known.has(k))
    .reduce((a, [, v]) => a + v, 0)
  const segments = [...PIPELINE.map((p) => ({ ...p, count: byStatus[p.status] ?? 0 })), { status: 'other', label: 'Other', color: 'bg-surface-muted', count: other }].filter(
    (s) => s.count > 0,
  )

  return (
    <Panel title="Submission pipeline" icon={FileText}>
      {total === 0 ? (
        <p className="py-2 text-sm text-text-muted">No submissions yet. They'll appear here as authors submit abstracts.</p>
      ) : (
        <>
          <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(', ')}>
            {segments.map((s) => (
              <div key={s.status} className={`${s.color} h-full first:rounded-l-full last:rounded-r-full`} style={{ width: `${(s.count / total) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {segments.map((s) => (
              <li key={s.status} className="flex items-center gap-2 text-text-muted">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.color}`} aria-hidden="true" />
                <span className="truncate">{s.label}</span>
                <span className="ml-auto font-medium tabular-nums text-text">{s.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

/** Horizontal magnitude bars (one hue), value always printed - long category names stay readable. */
function BarList({ rows }: { rows: Array<{ name: string; count: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,11rem)_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-text-muted" title={r.name}>
            {r.name}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            {r.count > 0 ? <span className="block h-full rounded-full bg-button" style={{ width: `${(r.count / max) * 100}%` }} /> : null}
          </span>
          <span className="text-right font-medium tabular-nums text-text">{r.count}</span>
        </li>
      ))}
    </ul>
  )
}

function DistributionCards({ data, analytics, base }: { data: Dashboard; analytics: ConvenorAnalytics | null; base: string }) {
  const tracks = data.submissions_per_track.map((t) => ({ name: t.track_name, count: t.count }))
  const categories = analytics?.registrations_by_category ?? []
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Submissions per track" action={<PanelLink to={`${base}/schedule-basics/tracks`}>Tracks</PanelLink>}>
        {tracks.length === 0 ? <p className="py-2 text-sm text-text-muted">No tracks yet — authors choose a track when they submit.</p> : <BarList rows={tracks} />}
      </Panel>
      {analytics ? (
        <Panel title="Registrations by category" action={<PanelLink to={`${base}/event/attendance`}>Attendance</PanelLink>}>
          {categories.length === 0 ? (
            <p className="py-2 text-sm text-text-muted">No registrations in the last 30 days.</p>
          ) : (
            <>
              <BarList rows={categories} />
              <p className="mt-3 text-xs text-text-muted">Last 30 days</p>
            </>
          )}
        </Panel>
      ) : null}
    </div>
  )
}

const QUICK_ACTIONS: Array<{ label: string; to: string; icon: LucideIcon }> = [
  { label: 'Submissions', to: 'papers/submissions', icon: FileText },
  { label: 'Assign reviewers', to: 'papers/auto-assign', icon: Shuffle },
  { label: 'Programme', to: 'event/programme', icon: CalendarDays },
  { label: 'Check-in desk', to: 'event/attendance', icon: QrCode },
  { label: 'Bulk email', to: 'communication/bulk-email', icon: Mail },
  { label: 'Members', to: 'people/members', icon: Users },
]

function QuickActions({ base }: { base: string }) {
  return (
    <Panel title="Quick actions">
      <ul className="-mx-1 grid grid-cols-2 gap-1">
        {QUICK_ACTIONS.map((a) => (
          <li key={a.label}>
            <Link
              to={`${base}/${a.to}`}
              className="flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text transition-colors hover:bg-page-bg"
            >
              <Icon icon={a.icon} size={16} className="shrink-0 text-button" />
              <span className="truncate">{a.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function UpcomingDeadlines({ deadlines, base }: { deadlines: DeadlineRow[]; base: string }) {
  const now = Date.now()
  const events = deadlines
    .flatMap((d) => {
      const label = DEADLINE_LABELS[d.code] ?? d.name
      const out: Array<{ key: string; label: string; at: string }> = []
      if (d.is_window && d.opens_at) out.push({ key: `${d.code}-open`, label: `${label} opens`, at: d.opens_at })
      if (d.closes_at) out.push({ key: `${d.code}-close`, label: d.is_window ? `${label} closes` : label, at: d.closes_at })
      return out
    })
    .filter((e) => new Date(e.at).getTime() >= now)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, 5)

  return (
    <Panel title="Upcoming deadlines" icon={CalendarClock} action={<PanelLink to={`${base}/schedule-basics/dates`}>Key dates</PanelLink>}>
      {events.length === 0 ? (
        <p className="py-1 text-sm text-text-muted">No upcoming key dates.</p>
      ) : (
        <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
          {events.map((e, i) => (
            <li key={e.key} className="relative pl-6">
              <span className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-surface ${i === 0 ? 'bg-gold' : 'bg-border-strong'}`} aria-hidden="true" />
              <p className="text-sm font-medium text-text">{e.label}</p>
              <p className="text-xs text-text-muted">
                {formatKathmandu(e.at)} · {relativeTime(e.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

function UpcomingSessions({ sessions, rooms, base }: { sessions: SessionRow[]; rooms: Room[]; base: string }) {
  const now = Date.now()
  const roomName = new Map(rooms.map((r) => [r.id, r.name]))
  const upcoming = sessions
    .filter((s) => new Date(s.ends_at).getTime() >= now && s.status !== 'cancelled')
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .slice(0, 4)

  return (
    <Panel title="Upcoming sessions" icon={CalendarDays} action={<PanelLink to={`${base}/event/programme`}>Programme</PanelLink>}>
      {upcoming.length === 0 ? (
        <p className="py-1 text-sm text-text-muted">{sessions.length === 0 ? 'No sessions scheduled yet.' : 'No upcoming sessions.'}</p>
      ) : (
        <ul className="space-y-3">
          {upcoming.map((s) => {
            const live = new Date(s.starts_at).getTime() <= now
            return (
              <li key={s.id} className="flex gap-3">
                <div className="w-[4.5rem] shrink-0 text-right">
                  <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-text">{formatKathmanduTime(s.starts_at)}</p>
                  <p className="whitespace-nowrap text-[11px] text-text-muted">{shortDay(s.starts_at)}</p>
                </div>
                <div className="min-w-0 flex-1 border-l-2 border-indigo-soft pl-3">
                  <p className="truncate text-sm font-medium text-text" title={s.title}>
                    {s.title}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-text-muted">
                    {roomName.get(s.room_id) ?? 'Room'}
                    {live ? <Badge tone="success">Now</Badge> : null}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function RecentActivity({ entries, base }: { entries: ActivityEntry[]; base: string }) {
  const recent = entries.slice(0, 6)
  return (
    <Panel title="Recent activity" icon={History} action={<PanelLink to={`${base}/communication/activity`}>Activity log</PanelLink>}>
      {recent.length === 0 ? (
        <p className="py-1 text-sm text-text-muted">No activity recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {recent.map((e) => (
            <li key={e.id} className="text-sm">
              <p className="text-text">
                <span className="font-medium">{e.actor_name ?? 'System'}</span> <span className="text-text-muted">·</span> {humanizeAuditAction(e.action)}
              </p>
              <p className="text-xs text-text-muted">
                <time dateTime={e.occurred_at} title={formatKathmandu(e.occurred_at)}>
                  {relativeTime(e.occurred_at)}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border-soft lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 bg-surface p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
