import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SUBMISSION_STATUS_LABELS, statusBadgeClass } from '../../lib/submissionDisplay'
import { SubmissionDetailPanel } from './SubmissionDetailPanel'

type Track = { id: string; name: string }

type Row = {
  id: string
  submission_code: string | null
  title: string
  status: string
  track_id: string
  track_name: string | null
  assigned: number
  completed: number
  avg_score: number | null
}

type RawSubmission = {
  id: string
  submission_code: string | null
  title: string
  status: string
  track_id: string
  conference_tracks: { name: string } | null
}

type RawAssignment = {
  submission_id: string
  status: string
  reviews: { status: string; overall_score: number | null } | null
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
    const [{ data: tracksData }, { data: subsData, error: subsError }, { data: assignData }] = await Promise.all([
      supabase.from('conference_tracks').select('id, name').eq('conference_id', conferenceId).order('display_order'),
      supabase
        .from('submissions')
        .select('id, submission_code, title, status, track_id, conference_tracks(name)')
        .eq('conference_id', conferenceId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false }),
      supabase
        .from('review_assignments')
        .select('submission_id, status, reviews(status, overall_score)')
        .eq('conference_id', conferenceId),
    ])

    if (subsError) {
      setError(subsError.message)
      setLoading(false)
      return
    }

    setTracks((tracksData ?? []) as Track[])

    const stats = new Map<string, { assigned: number; completed: number; scores: number[] }>()
    for (const a of (assignData ?? []) as unknown as RawAssignment[]) {
      if (a.status === 'cancelled') continue
      const entry = stats.get(a.submission_id) ?? { assigned: 0, completed: 0, scores: [] }
      entry.assigned += 1
      if (a.reviews?.status === 'submitted') {
        entry.completed += 1
        if (a.reviews.overall_score !== null) entry.scores.push(a.reviews.overall_score)
      }
      stats.set(a.submission_id, entry)
    }

    const nextRows: Row[] = ((subsData ?? []) as unknown as RawSubmission[]).map((s) => {
      const stat = stats.get(s.id)
      const avg = stat && stat.scores.length > 0 ? stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length : null
      return {
        id: s.id,
        submission_code: s.submission_code,
        title: s.title,
        status: s.status,
        track_id: s.track_id,
        track_name: s.conference_tracks?.name ?? null,
        assigned: stat?.assigned ?? 0,
        completed: stat?.completed ?? 0,
        avg_score: avg,
      }
    })

    setRows(nextRows)
    setError(null)
    setLoading(false)
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const filtered = rows.filter((r) => (!statusFilter || r.status === statusFilter) && (!trackFilter || r.track_id === trackFilter))

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
          {Object.entries(SUBMISSION_STATUS_LABELS).map(([code, label]) => (
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
      ) : filtered.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No submissions match.
        </p>
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
              {filtered.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-background" onClick={() => setSelectedId(r.id)}>
                  <td className="px-4 py-3 font-mono text-xs">{r.submission_code ?? '—'}</td>
                  <td className="px-4 py-3">{r.title}</td>
                  <td className="px-4 py-3">{r.track_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={statusBadgeClass(r.status)}>{SUBMISSION_STATUS_LABELS[r.status] ?? r.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {r.completed} / {r.assigned}
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
