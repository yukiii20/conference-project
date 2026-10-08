import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getRoleDefinition } from '../../lib/roles'
import { Avatar } from '../../components/Avatar'
import type { RoleRequestForReview, RoleRequestStatus } from '../../lib/types'

const TABS: RoleRequestStatus[] = ['pending', 'approved', 'rejected']

export function RoleRequestsTab({ conferenceId }: { conferenceId: string }) {
  const [tab, setTab] = useState<RoleRequestStatus>('pending')
  const [requests, setRequests] = useState<RoleRequestForReview[]>([])
  const [photoByApplicant, setPhotoByApplicant] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadRequests = useCallback(async () => {
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('get_role_requests', {
      p_conference_id: conferenceId,
    })
    if (rpcError) {
      setError(rpcError.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as RoleRequestForReview[]
    setRequests(rows)
    setError(null)

    // Best-effort: the convenor may see applicant photos here. If RLS
    // doesn't permit reading another user's profile this just comes back
    // empty and avatars fall back to initials — not treated as an error.
    const applicantIds = Array.from(new Set(rows.map((r) => r.applicant_id)))
    if (applicantIds.length > 0) {
      const { data: photoRows } = await supabase.from('profiles').select('id, photo_path').in('id', applicantIds)
      setPhotoByApplicant(Object.fromEntries((photoRows ?? []).map((p) => [p.id, p.photo_path])))
    }

    setLoading(false)
  }, [conferenceId])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  async function handleApprove(id: string) {
    if (!window.confirm('Approve this request?')) return
    setBusyId(id)
    const { error: rpcError } = await supabase.rpc('review_role_request', {
      p_request_id: id,
      p_approve: true,
    })
    setBusyId(null)
    if (rpcError) {
      setError(rpcError.message)
    } else {
      await loadRequests()
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
    const { error: rpcError } = await supabase.rpc('review_role_request', {
      p_request_id: id,
      p_approve: false,
      p_reason: reason.trim(),
    })
    setBusyId(null)
    if (rpcError) {
      setError(rpcError.message)
    } else {
      setRejectingId(null)
      await loadRequests()
    }
  }

  const filtered = requests.filter((r) => r.status === tab)

  return (
    <div className="mt-6">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="mt-2 flex gap-2 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${
              tab === t ? 'border-button text-button' : 'border-transparent text-ink/60'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/60">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No {tab} requests.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
          {filtered.map((request) => (
            <li key={request.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Avatar
                    photoPath={photoByApplicant[request.applicant_id]}
                    name={request.applicant_name ?? request.applicant_email ?? ''}
                    size="h-9 w-9"
                  />
                  <div>
                    <p className="font-medium">{request.applicant_name ?? request.applicant_email}</p>
                    <p className="text-sm text-ink/60">
                      {request.applicant_email ?? 'No email'} · {request.applicant_phone ?? 'No phone'}
                    </p>
                    <p className="mt-1 text-sm text-ink/70">
                      {getRoleDefinition(request.role_code)?.label ?? request.role_code} ·{' '}
                      {new Date(request.created_at).toLocaleDateString()}
                    </p>
                    {request.status === 'rejected' && request.reject_reason ? (
                      <p className="mt-1 text-sm text-red-600">Reason: {request.reject_reason}</p>
                    ) : null}
                  </div>
                </div>
                {request.status === 'pending' ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => handleApprove(request.id)}
                      disabled={busyId === request.id}
                      className="rounded-md bg-button px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => startReject(request.id)}
                      disabled={busyId === request.id}
                      className="rounded-md border border-line px-3 py-1 text-sm font-medium hover:bg-background disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>

              {rejectingId === request.id ? (
                <div className="mt-3 rounded-md border border-line bg-background p-3">
                  <label htmlFor={`reason-${request.id}`} className="block text-sm font-medium">
                    Reason for rejecting
                  </label>
                  <textarea
                    id={`reason-${request.id}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    className="mt-1 block w-full rounded-md border border-line px-3 py-2"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => confirmReject(request.id)}
                      disabled={busyId === request.id}
                      className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Confirm reject
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectingId(null)}
                      className="rounded-md border border-line px-3 py-1 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
