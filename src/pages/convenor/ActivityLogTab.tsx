import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'

type Entry = {
  id: number
  occurred_at: string
  actor_user_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  old_values: unknown
  new_values: unknown
}

type Member = { user_id: string; full_name: string }

export function ActivityLogTab({ conferenceId }: { conferenceId: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    api
      .get<{ members: Member[] }>(`/conferences/${conferenceId}/members`)
      // One row per role — someone holding two roles (e.g. reviewer and
      // session chair) otherwise shows up twice in this "filter by person"
      // list, with two options sharing the same key and value.
      .then((d) => {
        const seen = new Set<string>()
        setMembers(d.members.filter((m) => (seen.has(m.user_id) ? false : (seen.add(m.user_id), true))))
      })
      .catch(() => setMembers([]))
  }, [conferenceId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ entries: Entry[] }>(`/conferences/${conferenceId}/activity-log`, {
        actor: actor || undefined,
        action: action || undefined,
        from: from || undefined,
        to: to || undefined,
        page: String(page),
      })
      setEntries(data.entries)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the activity log.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, actor, action, from, to, page])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mt-6 max-w-4xl">
      <div className="flex flex-wrap gap-2">
        <select
          value={actor}
          onChange={(e) => {
            setPage(1)
            setActor(e.target.value)
          }}
          className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
        >
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </select>
        <input
          value={action}
          onChange={(e) => {
            setPage(1)
            setAction(e.target.value)
          }}
          placeholder="Action, e.g. track.create"
          className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setPage(1)
            setFrom(e.target.value)
          }}
          className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setPage(1)
            setTo(e.target.value)
          }}
          className="rounded-md border border-line px-3 py-2 text-sm focus:border-button"
        />
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-4 text-sm text-ink/60">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">No activity found.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">What</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-ink/70">{formatKathmandu(e.occurred_at)}</td>
                  <td className="px-3 py-2">{e.actor_name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                  <td className="px-3 py-2 text-xs text-ink/60">
                    {e.entity_type}
                    {e.entity_id ? ` · ${e.entity_id.slice(0, 8)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-sm text-ink/60">Page {page}</span>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={entries.length < 50}
          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
