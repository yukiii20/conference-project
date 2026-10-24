import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { Alert, Button, EmptyState, PageHeader, SkeletonText } from '../../components/ui'

type MyCertificate = {
  id: string
  recipient_name: string
  certificate_type: string
  certificate_number: string
  issued_at: string
  status: string
  revoked_reason: string | null
  verification_token: string
  conference_id: string
  conference_name: string
  conference_slug: string
}

const TYPE_LABELS: Record<string, string> = {
  participation: 'Participation',
  presentation: 'Presentation',
  speaker: 'Speaker',
  reviewer: 'Reviewer',
  session_chair: 'Session chair',
  staff: 'Staff',
  best_paper: 'Best paper',
}

export function MyCertificatesTab() {
  const [certificates, setCertificates] = useState<MyCertificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ certificates: MyCertificate[] }>('/me/certificates')
      setCertificates(data.certificates)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your certificates.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function copyVerifyLink(c: MyCertificate) {
    const url = `${window.location.origin}/verify/${c.verification_token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(c.id)
      setTimeout(() => setCopiedId((id) => (id === c.id ? null : id)), 2000)
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  return (
    <div className="mt-6 max-w-3xl">
      <PageHeader title="My certificates" subtitle="Certificates released to you across every conference you've attended." />
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {loading ? (
        <SkeletonText lines={4} className="mt-4" />
      ) : certificates.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface">
          <EmptyState title="No certificates yet." />
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {certificates.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-text">{TYPE_LABELS[c.certificate_type] ?? c.certificate_type}</p>
                  <p className="text-sm text-text-muted">{c.conference_name}</p>
                  <p className="mt-1 font-mono text-xs text-text-muted">{c.certificate_number}</p>
                  <p className="text-xs text-text-muted">Issued {formatKathmandu(c.issued_at, { dateOnly: true })}</p>
                  {c.status === 'revoked' ? (
                    <p className="mt-1 text-xs font-medium text-danger">
                      Revoked{c.revoked_reason ? `: ${c.revoked_reason}` : ''}
                    </p>
                  ) : null}
                </div>
                {c.status === 'issued' ? (
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <a
                      href={`${API_BASE}/conferences/${c.conference_id}/certificates/${c.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center justify-center rounded-md bg-button px-3 py-1.5 text-sm font-medium text-white hover:bg-button-hover"
                    >
                      Download PDF
                    </a>
                    <Button type="button" variant="link" size="sm" onClick={() => copyVerifyLink(c)}>
                      {copiedId === c.id ? 'Copied!' : 'Copy verify link'}
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
