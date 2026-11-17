import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, EyeOff, RotateCcw, Trash2 } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { formatKathmanduTime } from '../lib/datetime'
import { Badge, ConfirmDialog, EmptyState, ErrorState, SkeletonText } from '../components/ui'

type Question = {
  id: string
  body: string
  author_name: string | null
  status: 'visible' | 'answered' | 'hidden'
  vote_count: number
  created_at: string
}

type Data = {
  session: { id: string; title: string; starts_at: string; ends_at: string }
  window: { opens_at: string; closes_at: string; open: boolean }
  questions: Question[]
}

type Filter = 'open' | 'answered' | 'hidden' | 'all'
const POLL_MS = 5_000

/**
 * /moderate/:conferenceId/:sessionId - the chair's live Q&A view, made for holding a phone at
 * the lectern: big text, top-voted first, one tap to mark answered, hide or delete. Refreshes
 * every 5 seconds. Chairs of this session, convenors and managers only (checked by the server).
 */
export function QaModeratePage() {
  const { conferenceId = '', sessionId = '' } = useParams()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<{ text: string; status?: number } | null>(null)
  const [sort, setSort] = useState<'votes' | 'recent'>('votes')
  const [filter, setFilter] = useState<Filter>('open')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Question | null>(null)

  const base = `/conferences/${conferenceId}/sessions/${sessionId}/questions`

  const load = useCallback(async () => {
    try {
      setData(await api.get<Data>(`${base}/moderate`, { sort }))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? { text: err.message, status: err.status } : { text: "Can't reach the server." })
    }
  }, [base, sort])

  useEffect(() => {
    load()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  async function setStatus(q: Question, status: Question['status']) {
    setBusyId(q.id)
    try {
      await api.patch(`${base}/${q.id}`, { status })
      await load()
    } catch (err) {
      setError({ text: err instanceof ApiError ? err.message : 'Could not update this question.' })
    } finally {
      setBusyId(null)
    }
  }

  async function remove(q: Question) {
    setBusyId(q.id)
    try {
      await api.del(`${base}/${q.id}`)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError({ text: err instanceof ApiError ? err.message : 'Could not delete this question.' })
    } finally {
      setBusyId(null)
    }
  }

  const visible = (data?.questions ?? []).filter((q) =>
    filter === 'all' ? true : filter === 'open' ? q.status === 'visible' : q.status === filter,
  )
  const counts = {
    open: data?.questions.filter((q) => q.status === 'visible').length ?? 0,
    answered: data?.questions.filter((q) => q.status === 'answered').length ?? 0,
    hidden: data?.questions.filter((q) => q.status === 'hidden').length ?? 0,
  }

  return (
    <div className="min-h-dvh bg-page-bg px-4 py-4">
      <main className="mx-auto w-full max-w-xl">
        {error && !data ? (
          error.status === 401 ? (
            <ErrorState message="Sign in to moderate this session." />
          ) : (
            <ErrorState message={error.text} onRetry={error.status === 403 ? undefined : load} />
          )
        ) : !data ? (
          <SkeletonText lines={6} />
        ) : (
          <>
            <header className="sticky top-0 z-10 -mx-4 border-b border-border-soft bg-page-bg/95 px-4 pb-3 backdrop-blur">
              <p className="text-xs text-text-muted">
                Q&A · {formatKathmanduTime(data.session.starts_at)}–{formatKathmanduTime(data.session.ends_at)} ·{' '}
                {data.window.open ? <span className="font-medium text-success">open</span> : 'closed'}
              </p>
              <h1 className="font-display text-lg font-semibold text-text">{data.session.title}</h1>
              <div className="mt-2 flex gap-1 overflow-x-auto text-sm" role="tablist">
                {(['open', 'answered', 'hidden', 'all'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={`min-h-10 shrink-0 rounded-full px-3 capitalize ${filter === f ? 'bg-button text-on-brand' : 'bg-surface text-text'}`}
                  >
                    {f}
                    {f !== 'all' ? ` (${counts[f]})` : ''}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSort(sort === 'votes' ? 'recent' : 'votes')}
                  className="ml-auto min-h-10 shrink-0 rounded-full bg-surface px-3 text-text"
                >
                  {sort === 'votes' ? 'Top votes' : 'Newest'}
                </button>
              </div>
            </header>
            {error ? (
              <p className="mt-2 text-sm text-danger" role="alert">
                {error.text}
              </p>
            ) : null}
            {visible.length === 0 ? (
              <EmptyState title={filter === 'open' ? 'No open questions' : 'Nothing here'} message="New questions appear here automatically." />
            ) : (
              <ul className="mt-3 space-y-3">
                {visible.map((q) => (
                  <li key={q.id} className={`rounded-xl border border-border bg-surface p-4 ${q.status === 'hidden' ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-3">
                      <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-indigo-soft text-button">
                        <span className="text-lg font-semibold leading-none">{q.vote_count}</span>
                        <span className="text-[10px]">votes</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-line break-words text-lg leading-snug text-text">{q.body}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                          {q.author_name ?? 'Anonymous'} · {formatKathmanduTime(q.created_at)}
                          {q.status === 'answered' ? <Badge tone="success">Answered</Badge> : null}
                          {q.status === 'hidden' ? <Badge tone="warning">Hidden</Badge> : null}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {q.status === 'visible' ? (
                        <ActionButton onClick={() => setStatus(q, 'answered')} disabled={busyId === q.id} icon={<Check size={16} />} label="Answered" />
                      ) : (
                        <ActionButton onClick={() => setStatus(q, 'visible')} disabled={busyId === q.id} icon={<RotateCcw size={16} />} label="Reopen" />
                      )}
                      {q.status !== 'hidden' ? (
                        <ActionButton onClick={() => setStatus(q, 'hidden')} disabled={busyId === q.id} icon={<EyeOff size={16} />} label="Hide" />
                      ) : (
                        <span />
                      )}
                      <ActionButton onClick={() => setConfirmDelete(q)} disabled={busyId === q.id} icon={<Trash2 size={16} />} label="Delete" danger />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-6 text-center text-xs text-text-muted">
              <Link to="/portal/session-chair" className="underline">
                Back to my sessions
              </Link>
            </p>
          </>
        )}
      </main>
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this question?"
        message="It disappears for everyone. This is recorded in the activity log."
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
        busy={busyId !== null}
      />
    </div>
  )
}

function ActionButton({ onClick, disabled, icon, label, danger }: { onClick: () => void; disabled: boolean; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium disabled:opacity-50 ${
        danger ? 'border-danger/30 text-danger' : 'border-border text-text'
      }`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  )
}
