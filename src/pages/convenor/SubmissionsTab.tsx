import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { SUBMISSION_STATUS_LABELS } from '../../lib/submissionDisplay'
import { StatusChip } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'
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
        <button
          type="button"
          onClick={() => {
            setSelectedId(null)
            setRefreshKey((k) => k + 1)
          }}
          className="text-sm text-button underline"
        >
          ← Back to submissions
        </button>
        <SubmissionDetailPanel conferenceId={conferenceId} submissionId={selectedId} />
      </div>
    )
  }

  return (
    <div className="mt-6">
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      <div className="flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
        >
          <option value="">All statuses</option>
          {Object.entries(SUBMISSION_STATUS_LABELS)
            .filter(([code]) => code !== 'draft')
            .map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
        </select>
        <select
          value={trackFilter}
          onChange={(e) => setTrackFilter(e.target.value)}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
        >
          <option value="">All tracks</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/60">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-white">
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
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Track</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Reviews</th>
                <th className="px-4 py-2 font-medium">Avg score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-background" onClick={() => setSelectedId(r.id)}>
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
          </table>
        </div>
      )}
    </div>
  )
}
