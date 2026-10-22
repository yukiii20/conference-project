import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/authContext'
import { formatKathmandu } from '../../lib/datetime'
import { getRoleDefinition } from '../../lib/roles'
import { DEADLINE_LABELS } from '../conference/types'
import { Card, CardHeader, SkeletonText } from '../../components/ui'

type Deadline = { deadline_type: string; opens_at: string; closes_at: string | null }
type Submission = { id: string; title: string; status: string }
type Assignment = { id: string; title: string; due_at: string | null; status: string; is_overdue: boolean }
type ChairSession = { conference_id: string; title: string; starts_at: string }
type MyRegistration = { status: string } | null

type Todo = { text: string; linkPath?: string }

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

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      <Card>
        <CardHeader
          title={`Welcome, ${user?.full_name || user?.email}`}
          subtitle={myRoleLabels.length > 0 ? `Your roles: ${myRoleLabels.join(', ')}` : undefined}
        />
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text">To-dos</h3>
        {loading ? (
          <SkeletonText lines={2} className="mt-2" />
        ) : todos.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Nothing needs your attention right now.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {todos.map((t, i) =>
              t.linkPath ? (
                <li key={i}>
                  <Link to={t.linkPath} className="text-sm text-brand hover:underline">
                    {t.text}
                  </Link>
                </li>
              ) : (
                <li key={i} className="text-sm text-text/80">
                  {t.text}
                </li>
              ),
            )}
          </ul>
        )}
      </Card>

      {conferenceId ? (
        <Card>
          <h3 className="text-sm font-semibold text-text">Next key dates</h3>
          {loading ? (
            <SkeletonText lines={2} className="mt-2" />
          ) : upcomingDeadlines.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">No upcoming dates.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {upcomingDeadlines.map((d) => (
                <li key={d.deadline_type} className="flex items-center justify-between gap-2">
                  <span className="text-text/80">{DEADLINE_LABELS[d.deadline_type] ?? d.deadline_type}</span>
                  <span className="text-text-muted">
                    {formatKathmandu(d.opens_at, { dateOnly: true })}
                    {d.closes_at ? ` – ${formatKathmandu(d.closes_at, { dateOnly: true })}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  )
}
