import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { SUBMISSION_STATUS_LABELS } from '../../lib/submissionDisplay'
import { StatusChip, Spinner, EmptyState, ErrorState } from '../../components/ui'

type Row = {
  id: string
  submission_code: string | null
  title: string
  status: string
  track_name: string
  updated_at: string
}

export function SubmissionsList({
  conferenceId,
  onSelect,
  refreshKey,
}: {
  conferenceId: string
  onSelect: (id: string) => void
  refreshKey: number
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ submissions: Row[] }>(`/conferences/${conferenceId}/my-submissions`)
      setRows(data.submissions)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your submissions.')
    }
    setLoading(false)
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-6">
        <ErrorState message={error} onRetry={load} />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-border bg-surface">
        <EmptyState title="You haven't submitted anything yet." />
      </div>
    )
  }

  return (
    <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-muted"
          >
            <div>
              {r.submission_code ? <p className="font-mono text-xs text-text-muted">{r.submission_code}</p> : null}
              <p className="font-medium text-text">{r.title}</p>
              <p className="text-xs text-text-muted">{r.track_name}</p>
            </div>
            <StatusChip status={r.status} labels={SUBMISSION_STATUS_LABELS} />
          </button>
        </li>
      ))}
    </ul>
  )
}
