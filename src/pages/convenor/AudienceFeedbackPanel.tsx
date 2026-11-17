import { useCallback, useEffect, useState } from 'react'
import { Download, Eye, EyeOff, Trash2 } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { ChartCard, MagnitudeBar, SimpleTable, StatTile } from '../../components/analytics/ChartPrimitives'
import { Badge, ConfirmDialog, EmptyState, ErrorState, Input, Select, SkeletonText, buttonClasses } from '../../components/ui'

type Distribution = [number, number, number, number, number]

type Item = {
  kind: 'conference' | 'session'
  id: string
  session_id: string | null
  session_title: string | null
  rating: number
  text: string | null
  author_name: string | null
  status: 'visible' | 'hidden'
  created_at: string
}

type Summary = {
  scope: 'all' | 'chair'
  conference: { count: number; average: number | null; distribution: Distribution } | null
  sessions: Array<{ session_id: string; title: string; starts_at: string; count: number; average: number | null; distribution: Distribution }>
  items: Item[]
}

type Filters = { kind: '' | 'conference' | 'session'; session_id: string; rating: string; status: '' | 'visible' | 'hidden'; with_comment: boolean; q: string }
const EMPTY: Filters = { kind: '', session_id: '', rating: '', status: '', with_comment: false, q: '' }

function toQuery(f: Filters): Record<string, string> {
  const q: Record<string, string> = {}
  if (f.kind) q.kind = f.kind
  if (f.session_id) q.session_id = f.session_id
  if (f.rating) q.rating = f.rating
  if (f.status) q.status = f.status
  if (f.with_comment) q.with_comment = 'true'
  if (f.q.trim()) q.q = f.q.trim()
  return q
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)
const avg = (v: number | null) => (v === null ? '—' : v.toFixed(2))

/**
 * Audience feedback for organisers: conference average + distribution chart, per-session
 * table, a filterable comment list with hide/delete, and a CSV of what is filtered.
 * Names are shown only when the person did not choose to stay anonymous.
 */
export function AudienceFeedbackPanel({ conferenceId }: { conferenceId: string }) {
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [debouncedQ, setDebouncedQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Item | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 300)
    return () => clearTimeout(t)
  }, [filters.q])

  const effective = { ...filters, q: debouncedQ }
  const queryKey = JSON.stringify(toQuery(effective))

  const load = useCallback(async () => {
    try {
      setData(await api.get<Summary>(`/conferences/${conferenceId}/audience-feedback`, JSON.parse(queryKey)))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load audience feedback.')
    }
  }, [conferenceId, queryKey])

  useEffect(() => {
    load()
  }, [load])

  async function setStatus(item: Item, status: 'visible' | 'hidden') {
    setBusyId(item.id)
    try {
      await api.patch(`/conferences/${conferenceId}/audience-feedback/${item.kind}/${item.id}`, { status })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this feedback.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(item: Item) {
    setBusyId(item.id)
    try {
      await api.del(`/conferences/${conferenceId}/audience-feedback/${item.kind}/${item.id}`)
      setConfirm(null)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this feedback.')
    } finally {
      setBusyId(null)
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />
  if (!data) return <SkeletonText lines={6} />

  const csvHref = `${API_BASE}/conferences/${conferenceId}/audience-feedback/export.csv?${new URLSearchParams(JSON.parse(queryKey)).toString()}`
  const rated = data.sessions.filter((s) => s.count > 0)
  const filtered = queryKey !== '{}'
  const canModerate = data.scope === 'all'

  return (
    <div className="space-y-4">
      {data.conference ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Conference rating" value={avg(data.conference.average)} />
          <StatTile label="Conference responses" value={String(data.conference.count)} />
          <StatTile label="Sessions rated" value={`${rated.length} of ${data.sessions.length}`} />
          <StatTile label="Session ratings" value={String(data.sessions.reduce((a, s) => a + s.count, 0))} />
        </div>
      ) : null}

      {data.conference ? (
        <ChartCard
          title="How the Audience rated the conference"
          subtitle="Visible responses only"
          empty={data.conference.count === 0}
          table={<SimpleTable columns={['Stars', 'Responses']} rows={data.conference.distribution.map((n, i) => [`${i + 1}`, n])} />}
        >
          <MagnitudeBar data={data.conference.distribution.map((n, i) => ({ stars: `${i + 1}★`, count: n }))} xKey="stars" yKey="count" yLabel="Responses" />
        </ChartCard>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text">Sessions</h3>
        {data.sessions.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No published sessions yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="px-2 py-1 font-medium">Session</th>
                  <th className="px-2 py-1 font-medium">Ratings</th>
                  <th className="px-2 py-1 font-medium">Average</th>
                  <th className="px-2 py-1 font-medium">1–5★</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {data.sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        className="text-left text-button hover:underline"
                        onClick={() => setFilters((f) => ({ ...f, kind: 'session', session_id: s.session_id }))}
                      >
                        {s.title}
                      </button>
                      <div className="text-xs text-text-muted">{formatKathmandu(s.starts_at)}</div>
                    </td>
                    <td className="px-2 py-1.5">{s.count}</td>
                    <td className="px-2 py-1.5">{avg(s.average)}</td>
                    <td className="px-2 py-1.5 font-mono text-xs text-text-muted">{s.distribution.join(' / ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">Comments and ratings ({data.items.length})</h3>
          <a href={csvHref} className={buttonClasses('secondary', 'sm')}>
            <Download aria-hidden className="h-4 w-4" /> Export CSV
          </a>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Input
            type="search"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Search comments"
            aria-label="Search comments"
            className="lg:col-span-2"
            data-no-dirty
          />
          {canModerate ? (
            <Select value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value as Filters['kind'], session_id: '' }))} aria-label="Type" data-no-dirty>
              <option value="">Conference + sessions</option>
              <option value="conference">Conference only</option>
              <option value="session">Sessions only</option>
            </Select>
          ) : null}
          <Select value={filters.session_id} onChange={(e) => setFilters((f) => ({ ...f, session_id: e.target.value }))} aria-label="Session" data-no-dirty>
            <option value="">Any session</option>
            {data.sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.title}
              </option>
            ))}
          </Select>
          <Select value={filters.rating} onChange={(e) => setFilters((f) => ({ ...f, rating: e.target.value }))} aria-label="Rating" data-no-dirty>
            <option value="">Any rating</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} star{n === 1 ? '' : 's'}
              </option>
            ))}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as Filters['status'] }))} aria-label="Status" data-no-dirty>
            <option value="">Visible + hidden</option>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </Select>
        </div>
        <label className="mt-2 flex min-h-10 items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={filters.with_comment} onChange={(e) => setFilters((f) => ({ ...f, with_comment: e.target.checked }))} data-no-dirty />
          Only with a written comment
        </label>
        {error ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        {data.items.length === 0 ? (
          <EmptyState
            title={filtered ? 'Nothing matches these filters' : 'No audience feedback yet'}
            message={filtered ? undefined : 'Ratings appear here once sessions start and the Audience responds.'}
            actionLabel={filtered ? 'Clear filters' : undefined}
            onAction={filtered ? () => setFilters(EMPTY) : undefined}
          />
        ) : (
          <ul className="mt-3 divide-y divide-border-soft">
            {data.items.map((item) => (
              <li key={`${item.kind}-${item.id}`} className={`py-3 ${item.status === 'hidden' ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-gold" aria-label={`${item.rating} of 5 stars`}>
                    {stars(item.rating)}
                  </span>
                  <Badge tone={item.kind === 'conference' ? 'info' : 'neutral'}>{item.kind === 'conference' ? 'Conference' : item.session_title}</Badge>
                  {item.status === 'hidden' ? <Badge tone="warning">Hidden</Badge> : null}
                  <span className="text-xs text-text-muted">
                    {item.author_name ?? 'Anonymous'} · {formatKathmandu(item.created_at)}
                  </span>
                </div>
                {item.text ? <p className="mt-1 whitespace-pre-line break-words text-sm text-text">{item.text}</p> : null}
                {canModerate ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className={buttonClasses('ghost', 'sm')}
                      disabled={busyId === item.id}
                      onClick={() => setStatus(item, item.status === 'hidden' ? 'visible' : 'hidden')}
                    >
                      {item.status === 'hidden' ? <Eye aria-hidden className="h-4 w-4" /> : <EyeOff aria-hidden className="h-4 w-4" />}
                      {item.status === 'hidden' ? 'Show' : 'Hide'}
                    </button>
                    <button type="button" className={buttonClasses('ghost', 'sm', 'text-danger')} disabled={busyId === item.id} onClick={() => setConfirm(item)}>
                      <Trash2 aria-hidden className="h-4 w-4" /> Delete
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title="Delete this feedback?"
        message="It is removed from the results and the export, and the person can't submit it again. This is recorded in the activity log."
        confirmLabel="Delete"
        busy={busyId !== null}
        onConfirm={() => confirm && remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
