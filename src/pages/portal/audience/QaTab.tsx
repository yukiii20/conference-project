import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConferenceEnded } from '../../../lib/conferenceEndedContext'
import { useSearchParams } from 'react-router-dom'
import { ThumbsUp } from 'lucide-react'
import { api, ApiError } from '../../../lib/api'
import { formatKathmandu, formatKathmanduTime } from '../../../lib/datetime'
import { pickDefaultSession, type AudienceSession } from '../../../lib/audienceProgramme'
import { Alert, Badge, Button, EmptyState, ErrorState, PageHeader, Select, SkeletonText, Textarea } from '../../../components/ui'

type Question = {
  id: string
  body: string
  author_name: string | null
  is_mine: boolean
  status: 'visible' | 'answered' | 'hidden'
  vote_count: number
  voted_by_me: boolean
  created_at: string
}

type QaData = {
  session: { id: string; title: string }
  window: { opens_at: string; closes_at: string; open: boolean }
  my_count: number
  limit: number
  questions: Question[]
}

const MAX = 300
const POLL_MS = 10_000

/**
 * Audience Q&A for one session: ask (300 characters, optionally anonymous), upvote once, see
 * what was answered. Refreshes every 10 seconds while open. The server enforces every rule.
 */
export function QaTab({ conferenceId }: { conferenceId: string | null }) {
  const ended = useConferenceEnded()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sessions, setSessions] = useState<AudienceSession[] | null>(null)
  const [registered, setRegistered] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [qa, setQa] = useState<QaData | null>(null)
  const [qaError, setQaError] = useState<string | null>(null)
  const [sort, setSort] = useState<'votes' | 'recent'>('votes')
  const [draft, setDraft] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [posting, setPosting] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  const sessionId = searchParams.get('session') ?? ''

  const loadSessions = useCallback(async () => {
    if (!conferenceId) return
    setListError(null)
    try {
      const data = await api.get<{ sessions: AudienceSession[]; registered: boolean }>(`/conferences/${conferenceId}/audience/programme`)
      setSessions(data.sessions.filter((s) => s.status !== 'cancelled'))
      setRegistered(data.registered)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Can't reach the server.")
    }
  }, [conferenceId])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (sessions && !sessionId) {
      const id = pickDefaultSession(sessions)
      if (id) setSearchParams({ session: id }, { replace: true })
    }
  }, [sessions, sessionId, setSearchParams])

  const loadQa = useCallback(async () => {
    if (!conferenceId || !sessionId) return
    try {
      setQa(await api.get<QaData>(`/conferences/${conferenceId}/audience/sessions/${sessionId}/questions`, { sort }))
      setQaError(null)
    } catch (err) {
      setQaError(err instanceof ApiError ? err.message : "Can't reach the server.")
    }
  }, [conferenceId, sessionId, sort])

  useEffect(() => {
    setQa(null)
    loadQa()
  }, [loadQa])

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') loadQa()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [loadQa])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setPosting(true)
    setNotice(null)
    try {
      await api.post(`/conferences/${conferenceId}/audience/sessions/${sessionId}/questions`, { body, is_anonymous: anonymous })
      setDraft('')
      setNotice({ text: 'Your question has been posted.', error: false })
      await loadQa()
    } catch (err) {
      setNotice({ text: err instanceof ApiError ? err.message : "Can't reach the server.", error: true })
    } finally {
      setPosting(false)
    }
  }

  async function toggleVote(q: Question) {
    setQa((d) =>
      d
        ? { ...d, questions: d.questions.map((x) => (x.id === q.id ? { ...x, voted_by_me: !q.voted_by_me, vote_count: x.vote_count + (q.voted_by_me ? -1 : 1) } : x)) }
        : d,
    )
    try {
      const url = `/conferences/${conferenceId}/audience/questions/${q.id}/vote`
      const res = q.voted_by_me ? await api.del<{ vote_count: number }>(url) : await api.put<{ vote_count: number }>(url)
      setQa((d) => (d ? { ...d, questions: d.questions.map((x) => (x.id === q.id ? { ...x, vote_count: res.vote_count } : x)) } : d))
    } catch (err) {
      setNotice({ text: err instanceof ApiError ? err.message : 'Could not record your vote.', error: true })
      loadQa()
    }
  }

  const sessionOptions = useMemo(() => sessions ?? [], [sessions])
  const reachedLimit = qa ? qa.my_count >= qa.limit : false

  if (!conferenceId) {
    return (
      <div className="mt-6">
        <PageHeader title="Q&A" />
        <p className="mt-4 text-sm text-text-muted">Choose a conference above.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 max-w-2xl">
      <PageHeader title="Q&A" subtitle="Ask the speakers a question and vote for the ones you want answered." />
      {listError ? (
        <div className="mt-4">
          <ErrorState message={listError} onRetry={loadSessions} />
        </div>
      ) : !sessions ? (
        <div className="mt-4">
          <SkeletonText lines={3} />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState title="No sessions yet" message="Q&A opens for each session when it starts." />
      ) : (
        <>
          <Select
            className="mt-4"
            value={sessionId}
            onChange={(e) => setSearchParams({ session: e.target.value }, { replace: true })}
            aria-label="Session"
          >
            {sessionOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {formatKathmandu(s.starts_at)} — {s.title}
              </option>
            ))}
          </Select>

          {qaError ? (
            <div className="mt-4">
              <ErrorState message={qaError} onRetry={loadQa} />
            </div>
          ) : !qa ? (
            <div className="mt-4">
              <SkeletonText lines={4} />
            </div>
          ) : (
            <>
              {!registered ? (
                <div className="mt-4">
                  <Alert variant="warning">Asking and voting need a confirmed registration. You can still read the questions.</Alert>
                </div>
              ) : !qa.window.open || ended ? (
                <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-text-muted">
                  {ended
                    ? 'Questions are closed because this conference has ended.'
                    : new Date() < new Date(qa.window.opens_at)
                    ? `Questions open when the session starts (${formatKathmanduTime(qa.window.opens_at)}).`
                    : 'Questions for this session are closed.'}
                </p>
              ) : (
                <form onSubmit={submit} className="mt-4 space-y-2 rounded-xl border border-border bg-surface p-3">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
                    maxLength={MAX}
                    rows={3}
                    placeholder={reachedLimit ? `You have asked ${qa.limit} questions in this session.` : 'Type your question'}
                    aria-label="Your question"
                    disabled={reachedLimit || posting}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex min-h-10 items-center gap-2 text-sm text-text">
                      <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                      Ask anonymously
                    </label>
                    <span className={`text-xs ${draft.length >= MAX ? 'text-danger' : 'text-text-muted'}`} aria-live="polite">
                      {draft.length}/{MAX} · {qa.my_count} of {qa.limit} asked
                    </span>
                  </div>
                  <Button type="submit" className="w-full sm:w-auto" disabled={!draft.trim() || reachedLimit} loading={posting}>
                    Post question
                  </Button>
                </form>
              )}
              {notice ? (
                <p className={`mt-2 text-sm ${notice.error ? 'text-danger' : 'text-success'}`} role="status">
                  {notice.text}
                </p>
              ) : null}

              <div className="mt-5 flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-text">Questions ({qa.questions.length})</h2>
                <Select value={sort} onChange={(e) => setSort(e.target.value as 'votes' | 'recent')} className="w-auto text-sm" aria-label="Sort">
                  <option value="votes">Most votes</option>
                  <option value="recent">Newest</option>
                </Select>
              </div>
              {qa.questions.length === 0 ? (
                <EmptyState title="No questions yet" message={qa.window.open ? 'Be the first to ask.' : undefined} />
              ) : (
                <ul className="mt-2 space-y-2">
                  {qa.questions.map((q) => (
                    <li key={q.id} className="flex gap-3 rounded-xl border border-border bg-surface p-3">
                      <button
                        type="button"
                        onClick={() => toggleVote(q)}
                        disabled={q.is_mine || !qa.window.open || ended || !registered || q.status === 'hidden'}
                        aria-pressed={q.voted_by_me}
                        aria-label={q.voted_by_me ? 'Remove your vote' : 'Vote for this question'}
                        className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border text-xs font-semibold disabled:opacity-60 ${
                          q.voted_by_me ? 'border-button bg-indigo-soft text-button' : 'border-border text-text'
                        }`}
                      >
                        <ThumbsUp size={16} aria-hidden="true" fill={q.voted_by_me ? 'currentColor' : 'none'} />
                        {q.vote_count}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-line break-words text-sm text-text">{q.body}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                          <span>{q.author_name ?? 'Anonymous'}</span>
                          {q.is_mine ? <Badge>You</Badge> : null}
                          {q.status === 'answered' ? <Badge tone="success">Answered</Badge> : null}
                          {q.status === 'hidden' ? <Badge tone="warning">Hidden by the moderators</Badge> : null}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
