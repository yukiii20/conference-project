import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { SUBMISSION_STATUS_LABELS } from '../../lib/submissionDisplay'
import { StatusChip } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'
import { TableContainer } from '../../components/ui/Table'
import { Select, Spinner, Alert, Button, PageHeader } from '../../components/ui'
import { SubmissionDetailPanel } from './SubmissionDetailPanel'

type Track = { id: string; name: string }

type Row = {
  id: string
  submission_code: string | null
  title: string
  status: string
  track_name: string
  assignment_count: number
  completed_count: number
  avg_score: number | null
}

export function SubmissionsTab({ conferenceId }: { conferenceId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [trackFilter, setTrackFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tracksData, subsData] = await Promise.all([
        api.get<{ tracks: Track[] }>(`/conferences/${conferenceId}/tracks`),
        api.get<{ submissions: Row[] }>(`/conferences/${conferenceId}/submissions`, {
          status: statusFilter || undefined,
          track_id: trackFilter || undefined,
        }),
      ])
      setTracks(tracksData.tracks)
      setRows(subsData.submissions)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load submissions.')
    }
    setLoading(false)
  }, [conferenceId, statusFilter, trackFilter])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  if (selectedId) {
    return (
      <div className="mt-6">
        <Button
          variant="link"
          onClick={() => {
            setSelectedId(null)
            setRefreshKey((k) => k + 1)
          }}
        >
          ← Back to submissions
        </Button>
        <SubmissionDetailPanel conferenceId={conferenceId} submissionId={selectedId} />
      </div>
    )
  }

  return (
    <div className="mt-6">
      <PageHeader title="Submissions" subtitle="Browse submitted papers, their review progress, and status." />
      {error ? (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
          <option value="">All statuses</option>
          {Object.entries(SUBMISSION_STATUS_LABELS)
            .filter(([code]) => code !== 'draft')
            .map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
        </Select>
        <Select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)} className="w-auto">
          <option value="">All tracks</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
          <Spinner size="sm" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState
            title="No submissions match."
            message={statusFilter || trackFilter ? 'Try a different status or track filter.' : 'No one has submitted yet.'}
            actionLabel={statusFilter || trackFilter ? 'Clear filters' : undefined}
            onAction={
              statusFilter || trackFilter
                ? () => {
                    setStatusFilter('')
                    setTrackFilter('')
                  }
                : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-4">
          {/* Rows navigate to the detail panel on click, which the shared Table
              component doesn't support — kept hand-rolled with shared tokens. */}
          <TableContainer minWidth={720}>
            <thead>
              <tr className="border-b border-border bg-surface-muted text-text-muted">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Track</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Reviews</th>
                <th className="px-4 py-2 font-medium">Avg score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-muted" onClick={() => setSelectedId(r.id)}>
                  <td className="px-4 py-3 font-mono text-xs">{r.submission_code ?? '—'}</td>
                  <td className="px-4 py-3">{r.title}</td>
                  <td className="px-4 py-3">{r.track_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusChip status={r.status} labels={SUBMISSION_STATUS_LABELS} />
                  </td>
                  <td className="px-4 py-3">
                    {r.completed_count} / {r.assignment_count}
                  </td>
                  <td className="px-4 py-3">{r.avg_score !== null ? r.avg_score.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableContainer>
        </div>
      )}
    </div>
  )
}
