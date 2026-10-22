import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../../lib/api'
import { formatKathmandu } from '../../../lib/datetime'
import { Alert, Button, EmptyState, PageHeader, SkeletonText } from '../../../components/ui'

// Lazy for the same reason as the staff check-in page — zxing (~450 KB)
// only needs to load for a chair who actually opens this panel.
const CheckInPanel = lazy(() => import('../../../components/attendance/CheckInPanel'))

type ChairSession = {
  conference_id: string
  conference_name: string
  session_id: string
  title: string
  room_name: string
  starts_at: string
  ends_at: string
}

type SessionPresentation = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  authors: string[] | null
  speaker_name: string | null
  status: string
}

type SessionDetail = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  room: { name: string } | null
  presentations: SessionPresentation[]
}

function MarkAttendancePanel({
  conferenceId,
  sessionId,
  onBack,
}: {
  conferenceId: string
  sessionId: string
  onBack: () => void
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showCheckIn, setShowCheckIn] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ session: SessionDetail }>(
        `/conferences/${conferenceId}/sessions/${sessionId}/chair-view`,
      )
      setDetail(data.session)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this session.')
    }
  }, [conferenceId, sessionId])

  useEffect(() => {
    load()
  }, [load])

  async function mark(presentationId: string, status: 'presented' | 'absent') {
    setBusyId(presentationId)
    setError(null)
    try {
      await api.patch(`/conferences/${conferenceId}/sessions/${sessionId}/presentations/${presentationId}/mark`, {
        status,
      })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this presentation.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <Button type="button" variant="link" onClick={onBack}>
        ← Back to my sessions
      </Button>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      {!detail ? (
        <SkeletonText lines={3} className="mt-6" />
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold text-text">{detail.title}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {formatKathmandu(detail.starts_at)} – {formatKathmandu(detail.ends_at)}
            {detail.room ? ` · ${detail.room.name}` : ''}
          </p>

          <p className="mt-5 text-sm font-medium text-text">Presentations</p>
          {detail.presentations.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">Nothing scheduled in this session yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {detail.presentations.map((p) => (
                <li key={p.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-text">{p.title}</p>
                      <p className="text-xs text-text-muted">
                        {formatKathmandu(p.starts_at)} – {formatKathmandu(p.ends_at)}
                        {p.authors && p.authors.length > 0
                          ? ` · ${p.authors.join(', ')}`
                          : p.speaker_name
                            ? ` · ${p.speaker_name}`
                            : ''}
                      </p>
                      <p className="mt-1 text-xs capitalize text-text-muted">Status: {p.status}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={busyId === p.id} onClick={() => mark(p.id, 'presented')}>
                        Presented
                      </Button>
                      <Button type="button" variant="secondary" size="sm" disabled={busyId === p.id} onClick={() => mark(p.id, 'absent')}>
                        Absent
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 border-t border-border pt-4">
            <Button type="button" variant="link" onClick={() => setShowCheckIn((v) => !v)}>
              {showCheckIn ? 'Hide session check-in' : 'Check attendees into this session'}
            </Button>
            {showCheckIn ? (
              <div className="mt-3">
                <Suspense fallback={<SkeletonText lines={3} />}>
                  <CheckInPanel conferenceId={conferenceId} scope={{ type: 'session', sessionId }} />
                </Suspense>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

/** Cross-conference "My sessions" — every session this chair is assigned to, everywhere, via GET /api/me/chair-sessions. */
export function SessionChairSection() {
  const [sessions, setSessions] = useState<ChairSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{ conferenceId: string; sessionId: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ sessions: ChairSession[] }>('/me/chair-sessions')
      setSessions(data.sessions)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your sessions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader title="My sessions" />

      {error ? <Alert variant="danger">{error}</Alert> : null}

      {open ? (
        <div className="mt-4">
          <MarkAttendancePanel conferenceId={open.conferenceId} sessionId={open.sessionId} onBack={() => setOpen(null)} />
        </div>
      ) : loading ? (
        <SkeletonText lines={3} className="mt-4" />
      ) : sessions.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="You are not assigned to chair any sessions yet." />
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {sessions.map((s) => (
            <li
              key={s.session_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
            >
              <div>
                <p className="font-medium text-text">{s.title}</p>
                <p className="text-sm text-text-muted">
                  {s.conference_name} · {s.room_name}
                </p>
                <p className="text-sm text-text-muted">
                  {formatKathmandu(s.starts_at)} – {formatKathmandu(s.ends_at)}
                </p>
              </div>
              <Button type="button" onClick={() => setOpen({ conferenceId: s.conference_id, sessionId: s.session_id })}>
                Mark attendance
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
