import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../../lib/api'
import { formatKathmandu } from '../../../lib/datetime'
import { publicImageUrl } from '../../../lib/storage'
import { Badge, EmptyState, ErrorState, Input, PageHeader, SkeletonText } from '../../../components/ui'

type Speaker = {
  id: string
  full_name: string
  designation: string | null
  affiliation: string | null
  bio: string | null
  research_topics: string | null
  photo_path: string | null
  speaker_type: string
  sessions: Array<{ id: string; title: string; starts_at: string; ends_at: string; status: string }>
}

const TYPE_LABELS: Record<string, string> = { keynote: 'Keynote', invited: 'Invited', panelist: 'Panelist', guest: 'Guest' }

/** Audience "Speakers": photo, role, affiliation, research topics, bio and their sessions. */
export function AudienceSpeakersTab({ conferenceId }: { conferenceId: string | null }) {
  const [speakers, setSpeakers] = useState<Speaker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!conferenceId) return
    setError(null)
    try {
      setSpeakers((await api.get<{ speakers: Speaker[] }>(`/conferences/${conferenceId}/audience/speakers`)).speakers)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server. Check your connection.")
    }
  }, [conferenceId])

  useEffect(() => {
    setSpeakers(null)
    load()
  }, [load])

  const q = query.trim().toLowerCase()
  const visible = (speakers ?? []).filter(
    (s) => !q || [s.full_name, s.affiliation ?? '', s.research_topics ?? ''].join(' ').toLowerCase().includes(q),
  )

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader title="Speakers" subtitle="Who is speaking, what they work on, and when." />
      {!conferenceId ? (
        <p className="mt-4 text-sm text-text-muted">Choose a conference above.</p>
      ) : error ? (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : !speakers ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          <SkeletonText lines={2} />
          <SkeletonText lines={2} />
        </div>
      ) : speakers.length === 0 ? (
        <EmptyState title="No speakers announced yet" message="Check back closer to the conference." />
      ) : (
        <>
          <Input
            type="search"
            className="mt-4"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a name, affiliation or topic"
            aria-label="Search speakers"
          />
          {visible.length === 0 ? (
            <EmptyState title="No speakers match" actionLabel="Clear search" onAction={() => setQuery('')} />
          ) : (
            <ul className="mt-3 space-y-3">
              {visible.map((s) => {
                const photo = publicImageUrl(s.photo_path)
                const open = openId === s.id
                return (
                  <li key={s.id} className="rounded-xl border border-border bg-surface p-4">
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 text-left"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : s.id)}
                    >
                      {photo ? (
                        <img src={photo} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-soft font-semibold text-button" aria-hidden="true">
                          {s.full_name.slice(0, 1)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-text">{s.full_name}</span>
                        {s.designation || s.affiliation ? (
                          <span className="block text-sm text-text-muted">{[s.designation, s.affiliation].filter(Boolean).join(', ')}</span>
                        ) : null}
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <Badge tone="info">{TYPE_LABELS[s.speaker_type] ?? s.speaker_type}</Badge>
                        </span>
                        {s.research_topics ? <span className="mt-1 block text-sm text-text">Research: {s.research_topics}</span> : null}
                      </span>
                    </button>
                    {open ? (
                      <div className="mt-3 space-y-2 border-t border-border-soft pt-3 text-sm">
                        {s.bio ? <p className="whitespace-pre-line text-text">{s.bio}</p> : <p className="text-text-muted">No bio yet.</p>}
                        {s.sessions.length > 0 ? (
                          <ul className="space-y-1">
                            {s.sessions.map((x) => (
                              <li key={x.id} className={x.status === 'cancelled' ? 'text-text-muted line-through' : 'text-text'}>
                                {formatKathmandu(x.starts_at)} — {x.title}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
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
