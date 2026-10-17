import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { StatusChip } from './ui/Badge'

type EmailLogRow = {
  id: number
  recipient_email: string
  template_key: string
  subject: string
  status: string
  attempts: number
  error_message: string | null
  queued_at: string
  sent_at: string | null
}

const STATUSES = ['queued', 'sending', 'sent', 'delivered', 'bounced', 'failed'] as const

type Scope = 'admin' | { conferenceId: string }

/** Admin "Email log" page and convenor "Emails" tab share this — only the base URL differs. */
export function EmailLogTab({ scope }: { scope: Scope }) {
  const basePath = scope === 'admin' ? '/admin/email-log' : `/conferences/${scope.conferenceId}/email-log`
  const retryPath = (id: number) =>
    scope === 'admin' ? `/admin/email-log/${id}/retry` : `/conferences/${scope.conferenceId}/email-log/${id}/retry`

  const [rows, setRows] = useState<EmailLogRow[]>([])
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ entries: EmailLogRow[] }>(basePath, {
        status: status || undefined,
        page: String(page),
      })
      setRows(data.entries)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the email log.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, status, page])

  useEffect(() => {
    load()
  }, [load])

  async function handleRetry(id: number) {
    setRetryingId(id)
    try {
      await api.post(retryPath(id))
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not retry this email.')
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <div className="mt-6">
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/60">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
          No emails match.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink/60">
                <th className="px-4 py-2 font-medium">Recipient</th>
                <th className="px-4 py-2 font-medium">Template</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Attempts</th>
                <th className="px-4 py-2 font-medium">Queued</th>
                <th className="px-4 py-2 font-medium">Error</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">{r.recipient_email}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.template_key}</td>
                  <td className="px-4 py-3">{r.subject}</td>
                  <td className="px-4 py-3">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-4 py-3">{r.attempts}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(r.queued_at).toLocaleString()}</td>
                  <td className="max-w-[220px] px-4 py-3 truncate text-red-600" title={r.error_message ?? ''}>
                    {r.error_message ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'failed' ? (
                      <button
                        type="button"
                        onClick={() => handleRetry(r.id)}
                        disabled={retryingId === r.id}
                        className="rounded-md border border-line px-3 py-1 text-xs hover:bg-background disabled:opacity-50"
                      >
                        {retryingId === r.id ? 'Retrying…' : 'Retry'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-sm text-ink/60">Page {page}</span>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={rows.length === 0}
          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-background disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
