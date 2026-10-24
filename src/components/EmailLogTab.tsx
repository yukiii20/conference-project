import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { humanizeTemplateKey } from '../lib/humanize'
import { statusLabel } from '../lib/status'
import { StatusChip } from './ui/Badge'
import { Alert, Button, Select, Table } from './ui'
import type { Column } from './ui/Table'

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

  const columns: Column<EmailLogRow>[] = [
    { key: 'recipient', header: 'Recipient', render: (r) => r.recipient_email },
    { key: 'template', header: 'Template', render: (r) => humanizeTemplateKey(r.template_key) },
    { key: 'subject', header: 'Subject', render: (r) => r.subject },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
    { key: 'attempts', header: 'Attempts', render: (r) => r.attempts },
    { key: 'queued', header: 'Queued', render: (r) => new Date(r.queued_at).toLocaleString(), className: 'whitespace-nowrap' },
    {
      key: 'error',
      header: 'Error',
      render: (r) => (
        <span className="max-w-[220px] truncate text-danger" title={r.error_message ?? ''}>
          {r.error_message ?? '—'}
        </span>
      ),
      className: 'max-w-[220px] truncate',
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'failed' ? (
          <Button type="button" variant="secondary" size="sm" loading={retryingId === r.id} onClick={() => handleRetry(r.id)}>
            Retry
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="mt-6">
      {error ? (
        <Alert variant="danger">{error}</Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          className="w-auto"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        <Table columns={columns} rows={rows} rowKey={(r) => String(r.id)} loading={loading} emptyTitle="No emails match." minWidth={800} />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
          Previous
        </Button>
        <span className="text-sm text-text-muted">Page {page}</span>
        <Button type="button" variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={rows.length === 0}>
          Next
        </Button>
      </div>
    </div>
  )
}
