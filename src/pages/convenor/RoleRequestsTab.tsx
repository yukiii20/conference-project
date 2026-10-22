import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { getRoleDefinition } from '../../lib/roles'
import { Avatar } from '../../components/Avatar'
import { ConfirmDialog } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { PageHeader, Tabs, Button, Textarea, Alert, Spinner } from '../../components/ui'
import type { RoleRequestForReview, RoleRequestStatus } from '../../lib/types'

const TABS: RoleRequestStatus[] = ['pending', 'approved', 'rejected']

export function RoleRequestsTab({ conferenceId }: { conferenceId: string }) {
  const [tab, setTab] = useState<RoleRequestStatus>('pending')
  const [requests, setRequests] = useState<RoleRequestForReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmingApproveId, setConfirmingApproveId] = useState<string | null>(null)
  const { showToast } = useToast()

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ requests: RoleRequestForReview[] }>(`/conferences/${conferenceId}/role-requests`)
      setRequests(data.requests)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load role requests.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  async function handleApprove(id: string) {
    setConfirmingApproveId(null)
    setBusyId(id)
    try {
      await api.post(`/role-requests/${id}/approve`)
      showToast('Request approved.', 'success')
      await loadRequests()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not approve this request.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  function startReject(id: string) {
    setRejectingId(id)
    setReason('')
    setError(null)
  }

  async function confirmReject(id: string) {
    if (reason.trim().length < 3) {
      setError('Please give a short reason.')
      return
    }
    setBusyId(id)
    try {
      await api.post(`/role-requests/${id}/reject`, { reason: reason.trim() })
      setRejectingId(null)
      showToast('Request rejected.', 'success')
      await loadRequests()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not reject this request.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const filtered = requests.filter((r) => r.status === tab)

  return (
    <div className="mt-6">
      <PageHeader title="Role Requests" subtitle="Review and approve or reject requests to join a conference role." />
      {error ? (
        <div className="mb-2">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <Tabs
        tabs={TABS.map((t) => ({ id: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
        active={tab}
        onChange={(id) => setTab(id as RoleRequestStatus)}
      />

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
          <Spinner size="sm" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-sm text-text-muted">
          No {tab} requests.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {filtered.map((request) => (
            <li key={request.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Avatar photoPath={null} name={request.applicant_name ?? request.applicant_email ?? ''} size="h-9 w-9" />
                  <div>
                    <p className="font-medium text-text">{request.applicant_name ?? request.applicant_email}</p>
                    <p className="text-sm text-text-muted">
                      {request.applicant_email ?? 'No email'} · {request.applicant_phone ?? 'No phone'}
                    </p>
                    <p className="mt-1 text-sm text-text-muted">
                      {getRoleDefinition(request.role_code)?.label ?? request.role_code} ·{' '}
                      {new Date(request.created_at).toLocaleDateString()}
                    </p>
                    {request.status === 'rejected' && request.reject_reason ? (
                      <p className="mt-1 text-sm text-danger">Reason: {request.reject_reason}</p>
                    ) : null}
                  </div>
                </div>
                {request.status === 'pending' ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setConfirmingApproveId(request.id)}
                      disabled={busyId === request.id}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => startReject(request.id)}
                      disabled={busyId === request.id}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
              </div>

              {rejectingId === request.id ? (
                <div className="mt-3 rounded-md border border-border bg-page-bg p-3">
                  <label htmlFor={`reason-${request.id}`} className="block text-sm font-medium text-text">
                    Reason for rejecting
                  </label>
                  <Textarea
                    id={`reason-${request.id}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    className="mt-1"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button variant="danger" size="sm" onClick={() => confirmReject(request.id)} disabled={busyId === request.id}>
                      Confirm reject
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setRejectingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmingApproveId !== null}
        title="Approve this request?"
        message="This grants the role immediately."
        confirmLabel="Approve"
        confirmVariant="primary"
        busy={busyId === confirmingApproveId}
        onConfirm={() => confirmingApproveId && handleApprove(confirmingApproveId)}
        onCancel={() => setConfirmingApproveId(null)}
      />
    </div>
  )
}
