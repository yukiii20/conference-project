import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SUBMISSION_STATUS_LABELS, statusBadgeClass } from '../../lib/submissionDisplay'

type Row = {
  id: string
  submission_code: string | null
  title: string
  status: string
  track_id: string
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
    const { data, error: loadError } = await supabase
      .from('submissions')
      .select('id, submission_code, title, status, track_id, updated_at')
      .eq('conference_id', conferenceId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
    } else {
      setRows((data ?? []) as Row[])
      setError(null)
    }
    setLoading(false)
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  if (error) {
    return <p className="mt-6 text-sm text-red-600">{error}</p>
  }

  if (rows.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
        You haven't submitted anything yet.
      </p>
    )
  }

  return (
    <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-white">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-background"
          >
            <div>
              {r.submission_code ? <p className="font-mono text-xs text-ink/50">{r.submission_code}</p> : null}
              <p className="font-medium text-ink">{r.title}</p>
            </div>
            <span className={statusBadgeClass(r.status)}>{SUBMISSION_STATUS_LABELS[r.status] ?? r.status}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
