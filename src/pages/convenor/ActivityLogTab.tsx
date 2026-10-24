import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { humanizeAuditAction, humanizeIdentifier } from '../../lib/humanize'
import { PageHeader, Select, Input, Alert, Button, Table } from '../../components/ui'
import type { Column } from '../../components/ui/Table'

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
  const [debouncedAction, setDebouncedAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedAction(action), 300)
    return () => clearTimeout(t)
  }, [action])

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
        action: debouncedAction || undefined,
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
  }, [conferenceId, actor, debouncedAction, from, to, page])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<Entry>[] = [
    { key: 'when', header: 'When', render: (e) => <span className="whitespace-nowrap text-text-muted">{formatKathmandu(e.occurred_at)}</span> },
    { key: 'who', header: 'Who', render: (e) => e.actor_name ?? '—' },
    { key: 'action', header: 'Action', render: (e) => humanizeAuditAction(e.action) },
    {
      key: 'what',
      header: 'What',
      render: (e) => (
        <span className="text-xs text-text-muted">
          {humanizeIdentifier(e.entity_type)}
          {e.entity_id ? ` · ${e.entity_id.slice(0, 8)}` : ''}
        </span>
      ),
    },
  ]

  return (
    <div className="mt-6 max-w-4xl">
      <PageHeader title="Activity log" subtitle="A record of actions taken across this conference." />
      <div className="flex flex-wrap gap-2">
        <Select
          value={actor}
          onChange={(e) => {
            setPage(1)
            setActor(e.target.value)
          }}
          className="w-auto"
        >
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </Select>
        <Input
          value={action}
          onChange={(e) => {
            setPage(1)
            setAction(e.target.value)
          }}
          placeholder="Filter by action, e.g. publish"
          className="w-auto"
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setPage(1)
            setFrom(e.target.value)
          }}
          className="w-auto"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setPage(1)
            setTo(e.target.value)
          }}
          className="w-auto"
        />
      </div>

      {error ? (
        <div className="mt-3">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-4">
        <Table
          columns={columns}
          rows={entries}
          rowKey={(e) => String(e.id)}
          loading={loading}
          emptyTitle="No activity found."
          minWidth={720}
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
          Previous
        </Button>
        <span className="text-sm text-text-muted">Page {page}</span>
        <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={entries.length < 50}>
          Next
        </Button>
      </div>
    </div>
  )
}
