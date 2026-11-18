import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, MonitorPlay, Star } from 'lucide-react'
import { api, ApiError, API_BASE } from '../../../lib/api'
import { formatKathmandu, formatKathmanduTime } from '../../../lib/datetime'
import {
  EMPTY_FILTERS,
  filterSessions,
  joinState,
  programmeDays,
  type AudienceSession,
  type ProgrammeFilters,
} from '../../../lib/audienceProgramme'
import { Alert, Badge, EmptyState, ErrorState, Input, PageHeader, Select, SkeletonText, buttonClasses } from '../../../components/ui'

type Programme = {
  timezone: string
  registered: boolean
  sessions: AudienceSession[]
  tracks: Array<{ id: string; name: string }>
  rooms: Array<{ id: string; name: string }>
}

const MODE_LABEL: Record<AudienceSession['delivery_mode'], string> = { in_person: 'In person', online: 'Online', hybrid: 'Hybrid' }

function dayLabel(key: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${key}T00:00:00`))
}

/**
 * Audience "Programme": every published session (cancelled ones stay, marked), filters by day,
 * track and room, a search over titles and names, a star for My agenda, and "Join online" for
 * online/hybrid sessions. Phone first: one column, sticky filter bar, 44px touch targets.
 */
export function ProgrammeTab({ conferenceId }: { conferenceId: string | null }) {
  const [data, setData] = useState<Programme | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ProgrammeFilters>(EMPTY_FILTERS)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowMessage, setRowMessage] = useState<{ id: string; text: string; error: boolean } | null>(null)
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    if (!conferenceId) return
    setError(null)
    try {
      setData(await api.get<Programme>(`/conferences/${conferenceId}/audience/programme`))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server. Check your connection.")
    }
  }, [conferenceId])

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  // Re-render every minute so "Join online" flips on 15 minutes before the start.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const days = useMemo(() => (data ? programmeDays(data.sessions) : []), [data])
  const visible = useMemo(() => (data ? filterSessions(data.sessions, filters) : []), [data, filters])

  async function toggleStar(s: AudienceSession) {
    setBusyId(s.id)
    try {
      if (s.starred) await api.del(`/conferences/${conferenceId}/my-agenda/${s.id}`)
      else await api.put(`/conferences/${conferenceId}/my-agenda/${s.id}`)
      setData((d) => (d ? { ...d, sessions: d.sessions.map((x) => (x.id === s.id ? { ...x, starred: !s.starred } : x)) } : d))
    } catch (err) {
      setRowMessage({ id: s.id, text: err instanceof ApiError ? err.message : 'Could not update My agenda.', error: true })
    } finally {
      setBusyId(null)
    }
  }

  async function joinOnline(s: AudienceSession) {
    // Open the tab synchronously (inside the click) so pop-up blockers allow it, then point it at the link.
    const win = window.open('', '_blank')
    if (win) win.opener = null
    setBusyId(s.id)
    try {
      const res = await api.post<{ online_url: string; online_instructions: string | null }>(
        `/conferences/${conferenceId}/audience/sessions/${s.id}/join-online`,
        {},
      )
      if (win) win.location.href = res.online_url
      else window.location.href = res.online_url
      setData((d) => (d ? { ...d, sessions: d.sessions.map((x) => (x.id === s.id ? { ...x, attended: true } : x)) } : d))
      setRowMessage(res.online_instructions ? { id: s.id, text: res.online_instructions, error: false } : null)
    } catch (err) {
      win?.close()
      setRowMessage({ id: s.id, text: err instanceof ApiError ? err.message : "Can't reach the server.", error: true })
    } finally {
      setBusyId(null)
    }
  }

  if (!conferenceId) {
    return (
      <div className="mt-6">
        <PageHeader title="Programme" />
        <p className="mt-4 text-sm text-text-muted">Choose a conference above to see its programme.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader title="Programme" subtitle="Browse sessions, star the ones you want, and join online sessions." />

      {error ? (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : !data ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          <SkeletonText lines={3} />
          <SkeletonText lines={3} />
        </div>
      ) : (
        <>
          {!data.registered ? (
            <div className="mt-4">
              <Alert variant="warning">
                You can browse the programme, but joining online sessions needs a confirmed registration.{' '}
                <Link to="/portal/ticket" className="font-medium underline">
                  Open My ticket
                </Link>
              </Alert>
            </div>
          ) : null}

          <div className="sticky top-0 z-10 -mx-4 mt-4 space-y-2 border-b border-border-soft bg-page-bg/95 px-4 py-3 backdrop-blur">
            <Input
              type="search"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="Search a title or speaker"
              aria-label="Search sessions"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Select value={filters.day} onChange={(e) => setFilters((f) => ({ ...f, day: e.target.value }))} aria-label="Day">
                <option value="">All days</option>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </Select>
              <Select value={filters.trackId} onChange={(e) => setFilters((f) => ({ ...f, trackId: e.target.value }))} aria-label="Track">
                <option value="">All tracks</option>
                {data.tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <Select value={filters.roomId} onChange={(e) => setFilters((f) => ({ ...f, roomId: e.target.value }))} aria-label="Room">
                <option value="">All rooms</option>
                {data.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                aria-pressed={filters.onlyStarred}
                onClick={() => setFilters((f) => ({ ...f, onlyStarred: !f.onlyStarred }))}
                className={`flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium ${
                  filters.onlyStarred ? 'border-button bg-indigo-soft text-button' : 'border-border bg-surface text-text'
                }`}
              >
                <Star size={15} aria-hidden="true" fill={filters.onlyStarred ? 'currentColor' : 'none'} /> My agenda
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`${API_BASE}/conferences/${conferenceId}/my-agenda.ics`} className={buttonClasses('secondary', 'sm')}>
              <CalendarPlus aria-hidden className="h-4 w-4" /> My agenda to calendar (.ics)
            </a>
            <Link to="/portal/agenda" className={buttonClasses('ghost', 'sm')}>
              Calendar subscription link
            </Link>
          </div>

          {data.sessions.length === 0 ? (
            <EmptyState title="No sessions yet" message="The organisers have not published the programme. Check back soon." />
          ) : visible.length === 0 ? (
            <EmptyState
              title={filters.onlyStarred && !filters.query ? 'Nothing starred yet' : 'No sessions match'}
              message={filters.onlyStarred && !filters.query ? 'Tap the star on a session to add it to My agenda.' : 'Try another day, track or search.'}
              actionLabel="Clear filters"
              onAction={() => setFilters(EMPTY_FILTERS)}
            />
          ) : (
            <ul className="mt-3 space-y-3">
              {visible.map((s) => {
                const join = joinState(s)
                const cancelled = s.status === 'cancelled'
                return (
                  <li key={s.id} className={`rounded-xl border border-border bg-surface p-4 ${cancelled ? 'opacity-70' : ''}`}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-text-muted">
                          {formatKathmandu(s.starts_at, { dateOnly: true })} · {formatKathmanduTime(s.starts_at)}–{formatKathmanduTime(s.ends_at)}
                          {s.room && s.delivery_mode !== 'online' ? ` · ${s.room.name}` : ''}
                        </p>
                        <h3 className={`mt-0.5 font-medium text-text ${cancelled ? 'line-through' : ''}`}>{s.title}</h3>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
                          {s.schedule_change && !cancelled ? <Badge tone="warning">Schedule changed</Badge> : null}
                          {s.delivery_mode !== 'in_person' ? <Badge tone="info">{MODE_LABEL[s.delivery_mode]}</Badge> : null}
                          {s.track ? <Badge>{s.track.name}</Badge> : null}
                          {s.attended ? <Badge tone="success">Attended</Badge> : null}
                        </div>
                        {s.schedule_change ? (
                          <p className="mt-1 text-xs text-text-muted">
                            Changed {formatKathmandu(s.schedule_change.at)}: {s.schedule_change.summary}
                          </p>
                        ) : null}
                      </div>
                      {!cancelled ? (
                        <button
                          type="button"
                          onClick={() => toggleStar(s)}
                          disabled={busyId === s.id}
                          aria-pressed={s.starred}
                          aria-label={s.starred ? `Remove ${s.title} from My agenda` : `Add ${s.title} to My agenda`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gold hover:bg-page-bg disabled:opacity-50"
                        >
                          <Star size={22} aria-hidden="true" fill={s.starred ? 'currentColor' : 'none'} />
                        </button>
                      ) : null}
                    </div>

                    {s.presentations.length > 0 ? (
                      <ul className="mt-2 space-y-1 border-t border-border-soft pt-2 text-sm">
                        {s.presentations.map((p) => (
                          <li key={p.id}>
                            <span className="text-text">{p.title}</span>
                            {p.speaker_name || p.authors?.length ? (
                              <span className="text-text-muted"> — {p.speaker_name ?? p.authors!.join(', ')}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {join !== 'none' ? (
                      <div className="mt-3">
                        {join === 'open' ? (
                          <button
                            type="button"
                            onClick={() => joinOnline(s)}
                            disabled={busyId === s.id || !data.registered}
                            className={`${buttonClasses('primary', 'md')} w-full sm:w-auto`}
                          >
                            <MonitorPlay size={16} aria-hidden="true" /> Join online
                          </button>
                        ) : join === 'soon' ? (
                          <p className="text-sm text-text-muted">
                            Online link opens at {formatKathmanduTime(s.online_window!.opens_at)} (15 minutes before the start).
                          </p>
                        ) : (
                          <p className="text-sm text-text-muted">This online session has ended.</p>
                        )}
                      </div>
                    ) : null}
                    {rowMessage?.id === s.id ? (
                      <p className={`mt-2 whitespace-pre-line text-sm ${rowMessage.error ? 'text-danger' : 'text-text'}`} role="status">
                        {rowMessage.text}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
