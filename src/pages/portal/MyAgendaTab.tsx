import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarPlus, MapPin } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu, formatKathmanduTime, kathmanduDateKey } from '../../lib/datetime'
import { useToast } from '../../components/ui/Toast'
import { StarButton } from '../../components/agenda/StarButton'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Input, PageHeader, Select, SkeletonText, buttonClasses } from '../../components/ui'
import type { ScheduleRow } from '../conference/types'

type AgendaReason = 'starred' | 'chair' | 'presenting'

type AgendaSession = ScheduleRow & { reasons: AgendaReason[]; clashes_with: string[] }

type AgendaConference = {
  id: string
  name: string
  slug: string
  venue_name: string | null
  address: string | null
  city: string | null
  location_map_url: string | null
}

type AgendaResponse = { conference: AgendaConference; sessions: AgendaSession[]; starred_ids: string[] }

const REASON_LABELS: Record<AgendaReason, string> = {
  presenting: 'Your presentation',
  chair: 'You chair this',
  starred: 'Starred',
}

function groupByDay<T extends { starts_at: string }>(rows: T[]) {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = kathmanduDateKey(row.starts_at)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayRows]) => ({ key, label: formatKathmandu(dayRows[0]!.starts_at, { dateOnly: true }), rows: dayRows }))
}

function roomLabel(room: ScheduleRow['room']): string {
  if (!room) return ''
  return [room.name, room.room_number ? `Room ${room.room_number}` : null, room.building].filter(Boolean).join(', ')
}

/** Portal "My agenda": starred sessions plus your own talks and chaired sessions, by day, with calendar export. */
export function MyAgendaTab({ conferenceId: portalConferenceId }: { conferenceId: string | null }) {
  const { showToast } = useToast()
  const [conferences, setConferences] = useState<Array<{ id: string; name: string; slug: string }> | null>(null)
  const [conferenceId, setConferenceId] = useState<string | null>(null)
  const [agenda, setAgenda] = useState<AgendaResponse | null>(null)
  const [programme, setProgramme] = useState<ScheduleRow[] | null>(null)
  const [showProgramme, setShowProgramme] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedUrl, setFeedUrl] = useState<string | null>(null)
  const [feedBusy, setFeedBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    api
      .get<{ conferences: Array<{ id: string; name: string; slug: string }> }>('/me/agenda-conferences')
      .then((data) => {
        setConferences(data.conferences)
        const preferred = data.conferences.find((c) => c.id === portalConferenceId) ?? data.conferences[0]
        setConferenceId(preferred?.id ?? null)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your conferences.'))
  }, [portalConferenceId])

  const load = useCallback(async () => {
    if (!conferenceId) return
    try {
      const [agendaData, programmeData] = await Promise.all([
        api.get<AgendaResponse>(`/conferences/${conferenceId}/my-agenda`),
        api.get<{ schedule: ScheduleRow[] }>(`/conferences/${conferenceId}/sessions/public`),
      ])
      setAgenda(agendaData)
      setProgramme([...programmeData.schedule].sort((a, b) => a.starts_at.localeCompare(b.starts_at)))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your agenda.')
    }
  }, [conferenceId])

  useEffect(() => {
    setAgenda(null)
    setFeedUrl(null)
    load()
  }, [load])

  const starred = useMemo(() => new Set(agenda?.starred_ids ?? []), [agenda])
  const automatic = useMemo(
    () => new Set((agenda?.sessions ?? []).filter((s) => s.reasons.some((r) => r !== 'starred')).map((s) => s.id)),
    [agenda],
  )
  const titles = useMemo(() => new Map((agenda?.sessions ?? []).map((s) => [s.id, s.title])), [agenda])

  async function toggleStar(sessionId: string) {
    if (!conferenceId) return
    setBusyId(sessionId)
    const isStarred = starred.has(sessionId)
    try {
      if (isStarred) await api.del(`/conferences/${conferenceId}/my-agenda/${sessionId}`)
      else await api.put(`/conferences/${conferenceId}/my-agenda/${sessionId}`)
      showToast(isStarred ? 'Removed from your agenda.' : 'Added to your agenda.', 'success')
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update your agenda.', 'error')
    }
    setBusyId(null)
  }

  async function showFeed() {
    if (!conferenceId) return
    setFeedBusy(true)
    try {
      setFeedUrl((await api.get<{ url: string }>(`/conferences/${conferenceId}/my-agenda-feed`)).url)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not create your calendar link.', 'error')
    }
    setFeedBusy(false)
  }

  async function resetFeed() {
    if (!conferenceId) return
    setFeedBusy(true)
    try {
      setFeedUrl((await api.post<{ url: string }>(`/conferences/${conferenceId}/my-agenda-feed/reset`)).url)
      showToast('New calendar link created. The old link no longer works.', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not reset your calendar link.', 'error')
    }
    setFeedBusy(false)
    setConfirmReset(false)
  }

  async function copyFeed() {
    if (!feedUrl) return
    try {
      await navigator.clipboard.writeText(feedUrl)
      showToast('Calendar link copied.', 'success')
    } catch {
      showToast('Could not copy automatically - select the link and copy it.', 'error')
    }
  }

  const days = groupByDay(agenda?.sessions ?? [])
  const conference = agenda?.conference ?? null

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader
        title="My agenda"
        subtitle="Sessions you starred, plus your own presentations and sessions you chair - by day, in Nepal time."
        actions={
          conferenceId && agenda && agenda.sessions.length > 0 ? (
            <a href={`${API_BASE}/conferences/${conferenceId}/my-agenda.ics`} className={buttonClasses('secondary', 'md')}>
              <CalendarPlus aria-hidden className="h-4 w-4" /> Add all to calendar (.ics)
            </a>
          ) : undefined
        }
      />

      {conferences && conferences.length > 1 ? (
        <div className="mt-3">
          <label htmlFor="agenda-conference" className="block text-xs font-medium text-text-muted">
            Conference
          </label>
          <Select
            id="agenda-conference"
            value={conferenceId ?? ''}
            onChange={(e) => setConferenceId(e.target.value)}
            className="mt-1 max-w-sm"
          >
            {conferences.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      {conferences && conferences.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState
            title="No conferences yet."
            message="Register for a conference, then star the sessions you want to attend on its programme."
          />
          <p className="pb-6 text-center">
            <Link to="/" className={buttonClasses('primary', 'sm')}>
              Browse conferences
            </Link>
          </p>
        </div>
      ) : !agenda ? (
        error ? null : <SkeletonText lines={5} className="mt-4" />
      ) : (
        <>
          {agenda.sessions.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-surface">
              <EmptyState
                title="Your agenda is empty."
                message="Star the sessions you want to attend and they'll appear here, ready to add to your calendar."
                actionLabel={programme && programme.length > 0 ? 'Browse the programme' : undefined}
                onAction={() => setShowProgramme(true)}
              />
              {programme && programme.length === 0 ? (
                <p className="pb-6 text-center text-sm text-text-muted">The programme hasn't been published yet.</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 space-y-6">
              {days.map((day) => (
                <section key={day.key}>
                  <h2 className="font-semibold text-text">{day.label}</h2>
                  <ul className="mt-2 space-y-3">
                    {day.rows.map((s) => (
                      <li
                        key={s.id}
                        data-testid="agenda-session"
                        className={`rounded-lg border bg-surface p-4 ${s.clashes_with.length > 0 ? 'border-danger' : 'border-border'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-text-muted">
                              {formatKathmanduTime(s.starts_at)} – {formatKathmanduTime(s.ends_at)}
                            </p>
                            <p className="font-medium text-text">{s.title}</p>
                            <p className="mt-1 flex items-start gap-1 text-sm text-text-muted">
                              <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                              <span>
                                {roomLabel(s.room) || 'Room to be announced'}
                                {conference?.venue_name ? ` · ${conference.venue_name}` : ''}
                                {conference?.location_map_url ? (
                                  <>
                                    {' · '}
                                    <a
                                      href={conference.location_map_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-button hover:underline"
                                    >
                                      Map
                                    </a>
                                  </>
                                ) : null}
                              </span>
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {s.reasons.map((r) => (
                                <Badge key={r} tone={r === 'starred' ? 'neutral' : 'info'}>
                                  {REASON_LABELS[r]}
                                </Badge>
                              ))}
                            </div>
                            {s.clashes_with.length > 0 ? (
                              <p className="mt-2 flex items-start gap-1 text-sm font-medium text-danger">
                                <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                                Time clash with {s.clashes_with.map((id) => titles.get(id) ?? 'another session').join(', ')}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <StarButton
                              starred={starred.has(s.id)}
                              locked={!starred.has(s.id) && automatic.has(s.id)}
                              busy={busyId === s.id}
                              onToggle={() => toggleStar(s.id)}
                              sessionTitle={s.title}
                            />
                            <a
                              href={`${API_BASE}/conferences/${conferenceId}/sessions/public/${s.id}/ics`}
                              className="text-xs font-medium text-button hover:underline"
                            >
                              .ics
                            </a>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <section className="mt-8 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold text-text">Subscribe in Google Calendar or Outlook</h2>
            <p className="mt-1 text-sm text-text-muted">
              A private link that keeps your calendar in sync with this agenda. Anyone with the link can see your agenda, so
              don't share it - reset it if you think someone else has it.
            </p>
            {feedUrl ? (
              <div className="mt-3 space-y-2">
                <Input readOnly value={feedUrl} aria-label="Private calendar link" onFocus={(e) => e.currentTarget.select()} />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={copyFeed}>
                    Copy link
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmReset(true)} disabled={feedBusy}>
                    Reset link
                  </Button>
                </div>
                <p className="text-xs text-text-muted">
                  Google Calendar: Other calendars → + → From URL. Outlook: Add calendar → Subscribe from web. Calendar apps
                  refresh it every few hours.
                </p>
              </div>
            ) : (
              <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={showFeed} loading={feedBusy}>
                Show my calendar link
              </Button>
            )}
          </section>

          {programme && programme.length > 0 ? (
            <section className="mt-8">
              <Button type="button" variant="link" onClick={() => setShowProgramme((v) => !v)}>
                {showProgramme ? 'Hide the full programme' : 'Star more sessions from the full programme'}
              </Button>
              {showProgramme ? (
                <div className="mt-3 space-y-5">
                  {groupByDay(programme).map((day) => (
                    <div key={day.key}>
                      <h3 className="text-sm font-semibold text-text">{day.label}</h3>
                      <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
                        {day.rows.map((s) => (
                          <li key={s.id} data-testid="programme-session" className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-text">{s.title}</p>
                              <p className="text-xs text-text-muted">
                                {formatKathmanduTime(s.starts_at)} – {formatKathmanduTime(s.ends_at)}
                                {s.room ? ` · ${s.room.name}` : ''}
                              </p>
                            </div>
                            <StarButton
                              starred={starred.has(s.id)}
                              locked={!starred.has(s.id) && automatic.has(s.id)}
                              busy={busyId === s.id}
                              onToggle={() => toggleStar(s.id)}
                              sessionTitle={s.title}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset your calendar link?"
        message="The current link stops working straight away. You'll need to subscribe again with the new link in every calendar app that uses it."
        confirmLabel="Reset link"
        busy={feedBusy}
        onConfirm={resetFeed}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
