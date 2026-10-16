import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../../lib/api'
import { formatKathmandu } from '../../../lib/datetime'

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
      <button type="button" onClick={onBack} className="text-sm text-button underline">
        ← Back to my sessions
      </button>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {!detail ? (
        <p className="mt-6 text-sm text-ink/60">Loading…</p>
      ) : (
        <div className="mt-4 rounded-lg border border-line bg-white p-5">
          <h2 className="text-lg font-semibold text-ink">{detail.title}</h2>
          <p className="mt-1 text-sm text-ink/60">
            {formatKathmandu(detail.starts_at)} – {formatKathmandu(detail.ends_at)}
            {detail.room ? ` · ${detail.room.name}` : ''}
          </p>

          <p className="mt-5 text-sm font-medium text-ink">Presentations</p>
          {detail.presentations.length === 0 ? (
            <p className="mt-2 text-sm text-ink/60">Nothing scheduled in this session yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {detail.presentations.map((p) => (
                <li key={p.id} className="rounded-md border border-line px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{p.title}</p>
                      <p className="text-xs text-ink/60">
                        {formatKathmandu(p.starts_at)} – {formatKathmandu(p.ends_at)}
                        {p.authors && p.authors.length > 0
                          ? ` · ${p.authors.join(', ')}`
                          : p.speaker_name
                            ? ` · ${p.speaker_name}`
                            : ''}
                      </p>
                      <p className="mt-1 text-xs capitalize text-ink/50">Status: {p.status}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => mark(p.id, 'presented')}
                        disabled={busyId === p.id}
                        className="rounded-md border border-green-200 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                      >
                        Presented
                      </button>
                      <button
                        type="button"
                        onClick={() => mark(p.id, 'absent')}
                        disabled={busyId === p.id}
                        className="rounded-md border border-yellow-200 px-3 py-1 text-xs font-medium text-yellow-700 hover:bg-yellow-50 disabled:opacity-50"
                      >
                        Absent
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => setShowCheckIn((v) => !v)}
              className="text-sm font-medium text-button hover:underline"
            >
              {showCheckIn ? 'Hide session check-in' : 'Check attendees into this session'}
            </button>
            {showCheckIn ? (
              <div className="mt-3">
                <Suspense fallback={<p className="text-sm text-ink/60">Loading…</p>}>
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
      <h2 className="text-lg font-medium text-ink">My sessions</h2>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {open ? (
        <div className="mt-4">
          <MarkAttendancePanel conferenceId={open.conferenceId} sessionId={open.sessionId} onBack={() => setOpen(null)} />
        </div>
      ) : loading ? (
        <p className="mt-4 text-sm text-ink/60">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          You are not assigned to chair any sessions yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {sessions.map((s) => (
            <li
              key={s.session_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4"
            >
              <div>
                <p className="font-medium text-ink">{s.title}</p>
                <p className="text-sm text-ink/60">
                  {s.conference_name} · {s.room_name}
                </p>
                <p className="text-sm text-ink/60">
                  {formatKathmandu(s.starts_at)} – {formatKathmandu(s.ends_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen({ conferenceId: s.conference_id, sessionId: s.session_id })}
                className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Mark attendance
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
