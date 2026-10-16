import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'

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
      <h2 className="text-lg font-medium text-ink">My certificates</h2>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-4 text-sm text-ink/60">Loading…</p>
      ) : certificates.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No certificates yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {certificates.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">{TYPE_LABELS[c.certificate_type] ?? c.certificate_type}</p>
                  <p className="text-sm text-ink/60">{c.conference_name}</p>
                  <p className="mt-1 font-mono text-xs text-ink/50">{c.certificate_number}</p>
                  <p className="text-xs text-ink/50">Issued {formatKathmandu(c.issued_at, { dateOnly: true })}</p>
                  {c.status === 'revoked' ? (
                    <p className="mt-1 text-xs font-medium text-red-600">Revoked{c.revoked_reason ? `: ${c.revoked_reason}` : ''}</p>
                  ) : null}
                </div>
                {c.status === 'issued' ? (
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <a
                      href={`${API_BASE}/conferences/${c.conference_id}/certificates/${c.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-button px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                    >
                      Download PDF
                    </a>
                    <button type="button" onClick={() => copyVerifyLink(c)} className="text-xs text-button hover:underline">
                      {copiedId === c.id ? 'Copied!' : 'Copy verify link'}
                    </button>
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
