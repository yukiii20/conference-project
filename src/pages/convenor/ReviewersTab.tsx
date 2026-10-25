import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { useToast } from '../../components/ui/Toast'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, PageHeader, Spinner, TableContainer } from '../../components/ui'

type ReviewerRow = {
  reviewer_id: string
  full_name: string
  email: string
  pending_count: number
  overdue_count: number
  last_reminded_at: string | null
}

export function ReviewersTab({ conferenceId }: { conferenceId: string }) {
  const [rows, setRows] = useState<ReviewerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [remindingId, setRemindingId] = useState<string | null>(null)
  const [confirmRemindAll, setConfirmRemindAll] = useState(false)
  const [remindingAll, setRemindingAll] = useState(false)
  const { showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ reviewers: ReviewerRow[] }>(`/conferences/${conferenceId}/reviewers-pending`)
      setRows(data.reviewers)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load reviewers.')
    }
    setLoading(false)
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  async function handleRemind(reviewerId: string) {
    setRemindingId(reviewerId)
    try {
      const res = await api.post<{ sent: number }>(`/conferences/${conferenceId}/reviewers/${reviewerId}/remind`, {})
      showToast(`Reminder sent for ${res.sent} pending review${res.sent === 1 ? '' : 's'}.`, 'success')
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not send this reminder.', 'error')
    }
    setRemindingId(null)
  }

  async function handleRemindAll() {
    setRemindingAll(true)
    try {
      const res = await api.post<{ reviewers_notified: number }>(`/conferences/${conferenceId}/remind-all`, {})
      showToast(`Reminded ${res.reviewers_notified} reviewer${res.reviewers_notified === 1 ? '' : 's'}.`, 'success')
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not send reminders.', 'error')
    }
    setRemindingAll(false)
    setConfirmRemindAll(false)
  }

  return (
    <div className="mt-6">
      <PageHeader
        title="Reviewers"
        subtitle="Reviewers with at least one assigned review they haven't submitted yet."
        actions={
          rows.length > 0 ? (
            <Button type="button" variant="secondary" onClick={() => setConfirmRemindAll(true)}>
              Remind all with pending reviews
            </Button>
          ) : undefined
        }
      />
      {error ? (
        <div className="mt-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
          <Spinner size="sm" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="Nothing pending." message="No reviewer currently has an unsubmitted review." />
        </div>
      ) : (
        <div className="mt-4">
          <TableContainer minWidth={720}>
            <thead>
              <tr className="border-b border-border bg-surface-muted text-text-muted">
                <th className="px-4 py-2 font-medium">Reviewer</th>
                <th className="px-4 py-2 font-medium">Pending</th>
                <th className="px-4 py-2 font-medium">Overdue</th>
                <th className="px-4 py-2 font-medium">Last reminded</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.reviewer_id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-text">{r.full_name}</p>
                    <p className="text-xs text-text-muted">{r.email}</p>
                  </td>
                  <td className="px-4 py-3">{r.pending_count}</td>
                  <td className="px-4 py-3">
                    {r.overdue_count > 0 ? <Badge tone="danger">{r.overdue_count} overdue</Badge> : '—'}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {r.last_reminded_at ? formatKathmandu(r.last_reminded_at) : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRemind(r.reviewer_id)}
                      loading={remindingId === r.reviewer_id}
                    >
                      Send reminder now
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableContainer>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemindAll}
        title="Remind every reviewer with pending reviews?"
        message={`This emails ${rows.length} reviewer${rows.length === 1 ? '' : 's'} right now, regardless of the automatic reminder schedule.`}
        confirmLabel="Remind all"
        confirmVariant="primary"
        busy={remindingAll}
        onConfirm={handleRemindAll}
        onCancel={() => setConfirmRemindAll(false)}
      />
    </div>
  )
}
