import { useCallback, useEffect, useMemo, useState } from 'react'
import { Star } from 'lucide-react'
import { api, ApiError } from '../../../lib/api'
import { formatKathmandu } from '../../../lib/datetime'
import type { AudienceSession } from '../../../lib/audienceProgramme'
import { Alert, Button, EmptyState, ErrorState, PageHeader, SkeletonText, Textarea } from '../../../components/ui'

type MyFeedback = {
  closes_at: string | null
  conference: { rating: number; liked: string | null; improve: string | null; comments: string | null; is_anonymous: boolean; updated_at: string } | null
  ratings: Array<{ session_id: string; rating: number; comment: string | null; is_anonymous: boolean; updated_at: string }>
}

function StarInput({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(n)}
          className="flex h-11 w-11 items-center justify-center rounded-full text-gold hover:bg-page-bg"
        >
          <Star size={26} aria-hidden="true" fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  )
}

/**
 * Audience "Feedback": one conference feedback (editable), and a star rating + comment for every
 * session that has started. Only organisers see the answers; "anonymous" hides the name from
 * them too. Editable until the organisers' closing date, if they set one.
 */
export function AudienceFeedbackTab({ conferenceId }: { conferenceId: string }) {
  const [mine, setMine] = useState<MyFeedback | null>(null)
  const [sessions, setSessions] = useState<AudienceSession[]>([])
  const [registered, setRegistered] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [fb, prog] = await Promise.all([
        api.get<MyFeedback>(`/conferences/${conferenceId}/audience/feedback`),
        api.get<{ sessions: AudienceSession[]; registered: boolean }>(`/conferences/${conferenceId}/audience/programme`),
      ])
      setMine(fb)
      setSessions(prog.sessions)
      setRegistered(prog.registered)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server.")
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  const closed = mine?.closes_at ? new Date() > new Date(mine.closes_at) : false
  const started = useMemo(
    () => sessions.filter((s) => s.status !== 'cancelled' && new Date(s.starts_at) <= new Date()).reverse(),
    [sessions],
  )

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!mine) return <SkeletonText lines={5} />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your feedback"
        subtitle={
          mine.closes_at
            ? `Only the organisers see your answers. You can edit them until ${formatKathmandu(mine.closes_at)}.`
            : 'Only the organisers see your answers. You can come back and edit them.'
        }
      />
      {closed ? <Alert variant="info">Feedback for this conference is closed. Thank you!</Alert> : null}

      <ConferenceFeedbackForm conferenceId={conferenceId} current={mine.conference} disabled={closed} onSaved={load} />

      <section>
        <h2 className="font-display text-base font-semibold text-text">Rate the sessions</h2>
        {!registered ? (
          <p className="mt-2 text-sm text-text-muted">Rating sessions needs a confirmed registration.</p>
        ) : started.length === 0 ? (
          <EmptyState title="Nothing to rate yet" message="You can rate a session once it has started." />
        ) : (
          <ul className="mt-2 space-y-3">
            {started.map((s) => (
              <SessionRatingRow
                key={s.id}
                conferenceId={conferenceId}
                session={s}
                current={mine.ratings.find((r) => r.session_id === s.id) ?? null}
                disabled={closed}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ConferenceFeedbackForm({
  conferenceId,
  current,
  disabled,
  onSaved,
}: {
  conferenceId: string
  current: MyFeedback['conference']
  disabled: boolean
  onSaved: () => void
}) {
  const [rating, setRating] = useState(current?.rating ?? 0)
  const [liked, setLiked] = useState(current?.liked ?? '')
  const [improve, setImprove] = useState(current?.improve ?? '')
  const [anonymous, setAnonymous] = useState(current?.is_anonymous ?? false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!rating) {
      setMsg({ text: 'Choose 1 to 5 stars.', error: true })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const res = await api.put<{ message: string }>(`/conferences/${conferenceId}/audience/feedback`, {
        rating,
        liked: liked || null,
        improve: improve || null,
        is_anonymous: anonymous,
      })
      setMsg({ text: res.message, error: false })
      onSaved()
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : "Can't reach the server.", error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h2 className="font-display text-base font-semibold text-text">The conference overall</h2>
      <StarInput value={rating} onChange={setRating} label="Your rating of the conference" />
      <Textarea value={liked} onChange={(e) => setLiked(e.target.value)} maxLength={1000} rows={2} placeholder="What did you like?" aria-label="What did you like?" disabled={disabled} />
      <Textarea value={improve} onChange={(e) => setImprove(e.target.value)} maxLength={1000} rows={2} placeholder="What could be better?" aria-label="What could be better?" disabled={disabled} />
      <label className="flex min-h-10 items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} disabled={disabled} />
        Don't show my name to the organisers
      </label>
      <Button type="submit" loading={busy} disabled={disabled} className="w-full sm:w-auto">
        {current ? 'Update feedback' : 'Send feedback'}
      </Button>
      {msg ? (
        <p className={`text-sm ${msg.error ? 'text-danger' : 'text-success'}`} role="status">
          {msg.text}
        </p>
      ) : null}
    </form>
  )
}

function SessionRatingRow({
  conferenceId,
  session,
  current,
  disabled,
}: {
  conferenceId: string
  session: AudienceSession
  current: MyFeedback['ratings'][number] | null
  disabled: boolean
}) {
  const [rating, setRating] = useState(current?.rating ?? 0)
  const [comment, setComment] = useState(current?.comment ?? '')
  const [anonymous, setAnonymous] = useState(current?.is_anonymous ?? false)
  const [saved, setSaved] = useState(Boolean(current))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  async function save(stars = rating) {
    if (!stars) return
    setBusy(true)
    setMsg(null)
    try {
      await api.put(`/conferences/${conferenceId}/audience/sessions/${session.id}/rating`, {
        rating: stars,
        comment: comment || null,
        is_anonymous: anonymous,
      })
      setSaved(true)
      setMsg({ text: 'Saved.', error: false })
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : "Can't reach the server.", error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-text-muted">{formatKathmandu(session.starts_at)}</p>
      <h3 className="font-medium text-text">{session.title}</h3>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <StarInput
          value={rating}
          label={`Your rating of ${session.title}`}
          onChange={(n) => {
            if (disabled) return
            setRating(n)
            save(n)
          }}
        />
        {saved ? <span className="text-xs text-success">Rated</span> : null}
      </div>
      {!disabled ? (
        <button type="button" className="mt-1 min-h-10 text-sm font-medium text-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide comment' : current?.comment || comment ? 'Edit comment' : 'Add a comment'}
        </button>
      ) : null}
      {open ? (
        <div className="mt-2 space-y-2">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2} aria-label="Your comment" />
          <label className="flex min-h-10 items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Don't show my name
          </label>
          <Button type="button" size="sm" loading={busy} disabled={!rating} onClick={() => save()}>
            Save
          </Button>
        </div>
      ) : null}
      {msg ? (
        <p className={`mt-1 text-sm ${msg.error ? 'text-danger' : 'text-success'}`} role="status">
          {msg.text}
        </p>
      ) : null}
    </li>
  )
}
