import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { groupByTrack, type AbstractLike } from '../../lib/audienceFiles'
import { EmptyState, ErrorState, Input, Select, SkeletonText } from '../ui'

type Abstract = AbstractLike & { id: string }
type Data = { tracks: Array<{ id: string; name: string }>; abstracts: Abstract[] }

/**
 * Accepted abstracts with a search box and a track filter. Used by the Audience portal
 * (`/conferences/:id/audience/abstracts`) and by the public page (`.../abstracts/public`).
 * The server decides what is returned (accepted-or-later only, no sensitive fields).
 */
export function AcceptedAbstractsList({ endpoint, onUnavailable }: { endpoint: string; onUnavailable?: (message: string) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [trackId, setTrackId] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    try {
      const query: Record<string, string> = {}
      if (debouncedQ.trim()) query.q = debouncedQ.trim()
      if (trackId) query.track_id = trackId
      const next = await api.get<Data>(endpoint, query)
      // Keep the full track list from the unfiltered first load.
      setData((prev) => ({ tracks: prev && (debouncedQ || trackId) ? prev.tracks : next.tracks, abstracts: next.abstracts }))
      setError(null)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Can't reach the server."
      if (err instanceof ApiError && (err.status === 403 || err.status === 404) && onUnavailable) onUnavailable(message)
      setError(message)
    }
  }, [endpoint, debouncedQ, trackId, onUnavailable])

  useEffect(() => {
    load()
  }, [load])

  if (error && !data) return <ErrorState message={error} onRetry={load} />
  if (!data) return <SkeletonText lines={5} />

  const groups = groupByTrack(data.abstracts)
  const filtering = Boolean(debouncedQ.trim() || trackId)

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, abstract or author"
          aria-label="Search abstracts"
          className="sm:col-span-2"
        />
        <Select value={trackId} onChange={(e) => setTrackId(e.target.value)} aria-label="Track">
          <option value="">All tracks</option>
          {data.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
      <p className="mt-2 text-xs text-text-muted" aria-live="polite">
        {data.abstracts.length} paper{data.abstracts.length === 1 ? '' : 's'}
      </p>
      {data.abstracts.length === 0 ? (
        <EmptyState
          title={filtering ? 'No papers match' : 'No accepted papers yet'}
          actionLabel={filtering ? 'Clear search' : undefined}
          onAction={
            filtering
              ? () => {
                  setQ('')
                  setTrackId('')
                }
              : undefined
          }
        />
      ) : (
        <div className="mt-2 space-y-5">
          {groups.map((g) => (
            <section key={g.track}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{g.track}</h3>
              <ul className="mt-2 space-y-2">
                {g.items.map((a) => {
                  const open = openId === a.id
                  return (
                    <li key={a.id} className="rounded-xl border border-border bg-surface p-4">
                      <button type="button" className="w-full text-left" aria-expanded={open} onClick={() => setOpenId(open ? null : a.id)}>
                        {a.submission_code ? <span className="font-mono text-xs text-text-muted">{a.submission_code}</span> : null}
                        <span className="block font-medium text-text">{a.title}</span>
                        <span className="mt-0.5 block text-sm text-text-muted">
                          {a.authors.map((x) => (x.affiliation ? `${x.full_name} (${x.affiliation})` : x.full_name)).join(', ')}
                        </span>
                      </button>
                      {open ? (
                        <div className="mt-3 border-t border-border-soft pt-3">
                          <p className="whitespace-pre-line text-sm leading-relaxed text-text">{a.abstract}</p>
                          {a.keywords.length > 0 ? <p className="mt-2 text-xs text-text-muted">Keywords: {a.keywords.join(', ')}</p> : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
