import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { StatusChip } from '../../components/ui/Badge'
import { Alert, Button, EmptyState, SkeletonText, Textarea } from '../../components/ui'

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
    return <SkeletonText lines={4} className="mt-6" />
  }

  if (error) {
    return <Alert variant="danger">{error}</Alert>
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-border bg-surface">
        <EmptyState title="No review assignments yet." />
      </div>
    )
  }

  return (
    <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
      {rows.map((a) => (
        <li key={a.id} className="px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {a.submission_code ? <p className="font-mono text-xs text-text-muted">{a.submission_code}</p> : null}
              <p className="font-medium text-text">{a.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                <StatusChip status={a.status} labels={STATUS_LABELS} />
                {a.due_at ? <span>Due {new Date(a.due_at).toLocaleDateString()}</span> : null}
                {a.is_overdue ? <span className="font-medium text-danger">Overdue</span> : null}
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              {a.status === 'assigned' ? (
                <>
                  <Button type="button" size="sm" loading={busyId === a.id} onClick={() => handleAccept(a.id)}>
                    Accept
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busyId === a.id}
                    onClick={() => setDecliningId(a.id)}
                  >
                    Decline
                  </Button>
                </>
              ) : a.status === 'in_progress' || a.status === 'completed' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpen({ assignmentId: a.id, submissionId: a.submission_id })}
                >
                  {a.status === 'completed' ? 'View review' : 'Write review'}
                </Button>
              ) : null}
            </div>
          </div>

          {decliningId === a.id ? (
            <div className="mt-3 rounded-md border border-border bg-surface-muted p-3">
              <label className="block text-sm font-medium text-text">Reason (optional)</label>
              <Textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={2} className="mt-1" />
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="danger" size="sm" loading={busyId === a.id} onClick={() => handleDeclineConfirm(a.id)}>
                  Confirm decline
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setDecliningId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
