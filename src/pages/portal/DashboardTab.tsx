import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, FileText, ListChecks, Mic, QrCode, Ticket, type LucideIcon } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/authContext'
import { formatKathmandu } from '../../lib/datetime'
import { getRoleDefinition } from '../../lib/roles'
import { DEADLINE_LABELS } from '../conference/types'
import { Badge, Panel, SkeletonText } from '../../components/ui'
import { GiveFeedbackCard } from '../../components/feedback/GiveFeedbackCard'
import { Icon } from '../../components/ui/Icon'

type Deadline = { deadline_type: string; opens_at: string; closes_at: string | null }
type Submission = { id: string; title: string; status: string }
type Assignment = { id: string; title: string; due_at: string | null; status: string; is_overdue: boolean }
type ChairSession = { conference_id: string; title: string; starts_at: string }
type MyRegistration = { status: string } | null

type Todo = { text: string; linkPath?: string }

/** Shortcut tiles under the welcome banner; role-gated ones only show for roles the visitor holds here. */
const QUICK_LINKS: Array<{ path: string; label: string; icon: LucideIcon; role?: string }> = [
  { path: 'author', label: 'My submissions', icon: FileText, role: 'author' },
  { path: 'reviewer', label: 'My reviews', icon: ClipboardCheck, role: 'reviewer' },
  { path: 'session-chair', label: 'My sessions', icon: Mic, role: 'session_chair' },
  { path: 'staff', label: 'Check-in desk', icon: QrCode, role: 'staff' },
  { path: 'ticket', label: 'My ticket', icon: Ticket },
  { path: 'certificates', label: 'My certificates', icon: Award },
]

function isWindowOpen(opensAt: string | null, closesAt: string | null): boolean {
  if (!opensAt) return false
  const now = Date.now()
  if (now < new Date(opensAt).getTime()) return false
  if (closesAt && now > new Date(closesAt).getTime()) return false
  return true
}

export function DashboardTab({
  conferenceId,
  conferenceSlug,
  base,
  heldRoles,
}: {
  conferenceId: string | null
  conferenceSlug: string | null
  base: string
  heldRoles: Set<string>
}) {
  const { user, roles } = useAuth()
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const nextTodos: Todo[] = []
      let nextDeadlines: Deadline[] = []

      if (conferenceSlug) {
        try {
          const conf = await api.get<{ deadlines: Deadline[] }>(`/conferences/${conferenceSlug}`)
          nextDeadlines = conf.deadlines
        } catch {
          nextDeadlines = []
        }
      }

      if (conferenceId && heldRoles.has('author')) {
        try {
          const data = await api.get<{ submissions: Submission[] }>(`/conferences/${conferenceId}/my-submissions`)
          for (const s of data.submissions) {
            if (s.status === 'draft') nextTodos.push({ text: `Finish and submit: ${s.title}`, linkPath: `${base}/author` })
            if (s.status === 'revision_required') nextTodos.push({ text: `Revise and resubmit: ${s.title}`, linkPath: `${base}/author` })
            if (s.status === 'full_paper_pending') nextTodos.push({ text: `Upload your full paper: ${s.title}`, linkPath: `${base}/author` })
          }
        } catch {
          // non-fatal — the dashboard just shows fewer to-dos
        }
      }

      if (conferenceId && heldRoles.has('reviewer')) {
        try {
          const data = await api.get<{ assignments: Assignment[] }>('/reviewer/assignments', { conference_id: conferenceId })
          for (const a of data.assignments) {
            if (a.status === 'assigned') {
              nextTodos.push({
                text: a.due_at ? `Respond to a review request, due ${formatKathmandu(a.due_at)}: ${a.title}` : `Respond to a review request: ${a.title}`,
                linkPath: `${base}/reviewer`,
              })
            } else if (a.status === 'in_progress') {
              nextTodos.push({
                text: a.is_overdue ? `Overdue review: ${a.title}` : `Review due ${a.due_at ? formatKathmandu(a.due_at) : 'soon'}: ${a.title}`,
                linkPath: `${base}/reviewer`,
              })
            }
          }
        } catch {
          // non-fatal
        }
      }

      if (heldRoles.has('session_chair')) {
        try {
          const data = await api.get<{ sessions: ChairSession[] }>('/me/chair-sessions')
          const upcoming = data.sessions.filter((s) => new Date(s.starts_at).getTime() > Date.now())
          if (upcoming.length > 0) {
            nextTodos.push({
              text: `${upcoming.length} session${upcoming.length === 1 ? '' : 's'} coming up to chair`,
              linkPath: `${base}/session-chair`,
            })
          }
        } catch {
          // non-fatal
        }
      }

      if (conferenceId) {
        try {
          const reg = await api.get<{ registration: MyRegistration }>(`/conferences/${conferenceId}/my-registration`)
          if (!reg.registration) {
            const regWindow = nextDeadlines.find((d) => d.deadline_type === 'registration')
            if (regWindow && isWindowOpen(regWindow.opens_at, regWindow.closes_at)) {
              nextTodos.push({ text: 'Registration is open — register to attend', linkPath: `${base}/ticket` })
            }
          }
        } catch {
          // non-fatal
        }
      }

      if (!cancelled) {
        setDeadlines(nextDeadlines)
        setTodos(nextTodos)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [conferenceId, conferenceSlug, base, heldRoles])

  const myRoleLabels = [...new Set(roles.map((r) => r.role_code))]
    .filter((code) => code !== 'admin')
    .map((code) => getRoleDefinition(code)?.label ?? code)

  const upcomingDeadlines = [...deadlines]
    .filter((d) => new Date(d.opens_at).getTime() > Date.now() || (d.closes_at && new Date(d.closes_at).getTime() > Date.now()))
    .sort((a, b) => a.opens_at.localeCompare(b.opens_at))
    .slice(0, 4)

  const quickLinks = QUICK_LINKS.filter((q) => !q.role || heldRoles.has(q.role))
  const firstName = (user?.full_name || '').trim().split(/\s+/)[0] || user?.email

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-brand px-6 py-7 text-white shadow-card sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-indigo/30 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-gold/20 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
            <span className="h-px w-4 bg-gold/70" aria-hidden="true" />
            My portal
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Welcome, {firstName}</h2>
          {myRoleLabels.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Your roles">
              {myRoleLabels.map((label) => (
                <li key={label} className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
                  {label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <GiveFeedbackCard base={base} />

      {quickLinks.length > 0 ? (
        <nav aria-label="Quick links" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {quickLinks.map((q) => (
            <Link
              key={q.path}
              to={`${base}/${q.path}`}
              className="group flex items-center gap-3 rounded-xl border border-border-soft bg-surface p-3.5 shadow-card transition hover:-translate-y-0.5 hover:border-border hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-soft text-button">
                <Icon icon={q.icon} size={18} />
              </span>
              <span className="min-w-0 text-sm font-medium text-text">{q.label}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Icon icon={ListChecks} size={18} className="text-button" />
              To-dos
            </span>
          }
          action={!loading && todos.length > 0 ? <Badge tone="info">{todos.length}</Badge> : undefined}
        >
          {loading ? (
            <SkeletonText lines={3} />
          ) : todos.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg bg-success/5 px-4 py-3 text-sm text-text-muted">
              <Icon icon={CheckCircle2} className="text-success" />
              Nothing needs your attention right now.
            </div>
          ) : (
            <ul className="-mx-2 divide-y divide-border-soft">
              {todos.map((t, i) =>
                t.linkPath ? (
                  <li key={i}>
                    <Link
                      to={t.linkPath}
                      className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm text-text transition-colors hover:bg-page-bg"
                    >
                      <span className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                        {t.text}
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </li>
                ) : (
                  <li key={i} className="px-2 py-2.5 text-sm text-text/80">
                    {t.text}
                  </li>
                ),
              )}
            </ul>
          )}
        </Panel>

        {conferenceId ? (
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Icon icon={CalendarDays} size={18} className="text-button" />
                Next key dates
              </span>
            }
          >
            {loading ? (
              <SkeletonText lines={3} />
            ) : upcomingDeadlines.length === 0 ? (
              <p className="text-sm text-text-muted">No upcoming dates.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-border-soft pl-5">
                {upcomingDeadlines.map((d) => {
                  const open = isWindowOpen(d.opens_at, d.closes_at)
                  return (
                    <li key={d.deadline_type} className="relative text-sm">
                      <span
                        className={`absolute -left-[1.6rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface ${open ? 'bg-success' : 'bg-gold'}`}
                        aria-hidden="true"
                      />
                      <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                        {DEADLINE_LABELS[d.deadline_type] ?? d.deadline_type}
                        {open ? <Badge tone="success">Open now</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {formatKathmandu(d.opens_at, { dateOnly: true })}
                        {d.closes_at ? ` – ${formatKathmandu(d.closes_at, { dateOnly: true })}` : ''}
                      </p>
                    </li>
                  )
                })}
              </ol>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  )
}
