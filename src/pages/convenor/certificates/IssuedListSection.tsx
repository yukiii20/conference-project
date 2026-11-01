import { useCallback, useEffect, useState } from 'react'
import { Send, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../../lib/api'
import { formatKathmandu } from '../../../lib/datetime'
import { Alert, Button, ConfirmDialog, EmptyState, FormField, Input, SkeletonText, StatusChip, TableContainer } from '../../../components/ui'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { TYPE_LABELS, type Certificate } from './shared'

export function IssuedListSection({ conferenceId, refreshKey }: { conferenceId: string; refreshKey: number }) {
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [releasing, setReleasing] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<Certificate | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revoking, setRevoking] = useState(false)
  const { showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ certificates: Certificate[] }>(`/conferences/${conferenceId}/certificates`)
      setCertificates(data.certificates)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load certificates.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function confirmRevoke() {
    if (!revokeTarget || !revokeReason.trim()) return
    setRevoking(true)
    try {
      await api.patch(`/conferences/${conferenceId}/certificates/${revokeTarget.id}/revoke`, { reason: revokeReason.trim() })
      showToast('Certificate revoked.', 'success')
      setRevokeTarget(null)
      setRevokeReason('')
      await load()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not revoke this certificate.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setRevoking(false)
    }
  }

  async function releaseNow() {
    setReleasing(true)
    try {
      const res = await api.post<{ released: number }>(`/conferences/${conferenceId}/certificates/release-now`)
      showToast(res.released > 0 ? `Released ${res.released} certificate(s) — recipients can now download them.` : 'Nothing new to release.', 'success')
      await load()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not release certificates.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setReleasing(false)
    }
  }

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold text-brand">Issued certificates</h2>
          <p className="text-sm text-text-muted">
            Issuing a certificate doesn't send it — "Release now" makes every issued-but-unreleased certificate downloadable and
            emails the recipient.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={releaseNow}
          disabled={releasing}
          loading={releasing}
          iconLeft={<Icon icon={Send} size={16} />}
        >
          {releasing ? 'Releasing…' : 'Release now'}
        </Button>
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {loading ? (
        <SkeletonText lines={3} className="mt-3" />
      ) : certificates.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No certificates issued yet." />
        </div>
      ) : (
        <div className="mt-3">
          <TableContainer minWidth={700}>
            <thead>
              <tr className="border-b border-border bg-surface-muted text-text-muted">
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Recipient</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Issued</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {certificates.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-mono text-xs">{c.certificate_number}</td>
                  <td className="px-4 py-2">{c.recipient_name}</td>
                  <td className="px-4 py-2">{TYPE_LABELS[c.certificate_type] ?? c.certificate_type}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatKathmandu(c.issued_at)}</td>
                  <td className="px-4 py-2">
                    <StatusChip status={c.status} />
                  </td>
                  <td className="px-4 py-2">
                    {c.status === 'issued' ? (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setRevokeTarget(c)
                          setRevokeReason('')
                        }}
                        iconLeft={<Icon icon={Trash2} size={16} />}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableContainer>
        </div>
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke this certificate?"
        message={
          <div className="space-y-3">
            <p>
              {revokeTarget?.recipient_name} will no longer be able to download their {revokeTarget ? (TYPE_LABELS[revokeTarget.certificate_type] ?? revokeTarget.certificate_type) : ''} certificate, and anyone verifying it will see it as revoked. This can't be undone.
            </p>
            <FormField label="Reason (shown in the activity log)" htmlFor="revoke-reason">
              <Input
                id="revoke-reason"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Issued to the wrong person"
                autoFocus
              />
            </FormField>
          </div>
        }
        confirmLabel="Revoke"
        confirmVariant="danger"
        busy={revoking}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  )
}
