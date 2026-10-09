import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'

type Assignment = {
  id: string
  submission_id: string
  submission_code: string | null
  title: string
  track_name: string
  due_at: string | null
  status: string
  is_overdue: boolean
}

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Awaiting response',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

function statusClass(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-700'
    case 'declined':
    case 'cancelled':
      return 'bg-red-100 text-red-700'
    case 'in_progress':
      return 'bg-blue-100 text-blue-700'
    default:
      return 'bg-ink/10 text-ink/70'
  }
}

export function AssignmentsList({
  conferenceId,
  onOpen,
  refreshKey,
}: {
  conferenceId: string
  onOpen: (a: { assignmentId: string; submissionId: string }) => void
  refreshKey: number
}) {
  const [rows, setRows] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const [declineReason, setDeclineReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ assignments: Assignment[] }>('/reviewer/assignments', { conference_id: conferenceId })
      setRows(data.assignments)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your assignments.')
    }
    setLoading(false)
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function handleAccept(id: string) {
    setBusyId(id)
    try {
      await api.post(`/reviewer/assignments/${id}/accept`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept this assignment.')
    }
    setBusyId(null)
  }

  async function handleDeclineConfirm(id: string) {
    setBusyId(id)
    try {
      await api.post(`/reviewer/assignments/${id}/decline`, { reason: declineReason.trim() || undefined })
      setDecliningId(null)
      setDeclineReason('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not decline this assignment.')
    }
    setBusyId(null)
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  if (error) {
    return <p className="mt-6 text-sm text-red-600">{error}</p>
  }

  if (rows.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
        No review assignments yet.
      </p>
    )
  }

  return (
    <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-white">
      {rows.map((a) => (
        <li key={a.id} className="px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {a.submission_code ? <p className="font-mono text-xs text-ink/50">{a.submission_code}</p> : null}
              <p className="font-medium text-ink">{a.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink/60">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(a.status)}`}>
                  {STATUS_LABELS[a.status] ?? a.status}
                </span>
                {a.due_at ? <span>Due {new Date(a.due_at).toLocaleDateString()}</span> : null}
                {a.is_overdue ? <span className="font-medium text-red-600">Overdue</span> : null}
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              {a.status === 'assigned' ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleAccept(a.id)}
                    disabled={busyId === a.id}
                    className="rounded-md bg-button px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecliningId(a.id)}
                    disabled={busyId === a.id}
                    className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-50"
                  >
                    Decline
                  </button>
                </>
              ) : a.status === 'in_progress' || a.status === 'completed' ? (
                <button
                  type="button"
                  onClick={() => onOpen({ assignmentId: a.id, submissionId: a.submission_id })}
                  className="rounded-md border border-button px-3 py-1 text-sm font-medium text-button hover:bg-button/5"
                >
                  {a.status === 'completed' ? 'View review' : 'Write review'}
                </button>
              ) : null}
            </div>
          </div>

          {decliningId === a.id ? (
            <div className="mt-3 rounded-md border border-line bg-background p-3">
              <label className="block text-sm font-medium">Reason (optional)</label>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border border-line px-3 py-2"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleDeclineConfirm(a.id)}
                  disabled={busyId === a.id}
                  className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                >
                  Confirm decline
                </button>
                <button type="button" onClick={() => setDecliningId(null)} className="rounded-md border border-line px-3 py-1 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
