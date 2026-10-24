import { useCallback, useEffect, useState } from 'react'
import { Eye, Pencil, Send, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { RECIPIENT_GROUPS, RECIPIENT_GROUP_LABELS, bulkEmailSchema, type RecipientGroup } from '../../lib/validation'
import { formatKathmandu } from '../../lib/datetime'
import {
  PageHeader,
  Badge,
  StatusChip,
  Button,
  FormField,
  Input,
  Textarea,
  Checkbox,
  Alert,
  Spinner,
  ConfirmDialog,
  Modal,
} from '../../components/ui'
import { Icon } from '../../components/ui/Icon'
import { Table } from '../../components/ui/Table'
import { useToast } from '../../components/ui/Toast'

type BulkEmailSummary = {
  id: string
  subject: string
  status: 'draft' | 'sent'
  recipient_groups: RecipientGroup[]
  recipient_count: number
  sent_count: number
  failed_count: number
  created_by_name: string
  sent_at: string | null
  created_at: string
}

type BulkEmailDetail = BulkEmailSummary & {
  body_html: string
  recipients: Array<{ recipient_email: string; recipient_name: string | null; delivery_status: string | null; error_message: string | null }>
}

type RecipientPreview = {
  count: number
  preview: Array<{ name: string; email: string }>
  daily_limit: number
  used_today: number
  remaining_today: number
}

type FormState = { id: string | null; subject: string; body_html: string; recipient_groups: RecipientGroup[] }
const EMPTY_FORM: FormState = { id: null, subject: '', body_html: '', recipient_groups: [] }

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', sent: 'Sent' }
const DELIVERY_LABELS: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  bounced: 'Bounced',
  failed: 'Failed',
}

export function BulkEmailTab({ conferenceId }: { conferenceId: string }) {
  const { showToast } = useToast()

  const [list, setList] = useState<BulkEmailSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testSending, setTestSending] = useState(false)

  const [recipientPreview, setRecipientPreview] = useState<RecipientPreview | null>(null)
  const [recipientLoading, setRecipientLoading] = useState(false)

  const [contentPreview, setContentPreview] = useState<{ subject: string; html: string } | null>(null)

  const [sendConfirmOpen, setSendConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<BulkEmailSummary | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [detail, setDetail] = useState<BulkEmailDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ bulk_emails: BulkEmailSummary[] }>(`/conferences/${conferenceId}/bulk-email`)
      setList(data.bulk_emails)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load bulk emails. Your convenor may not have given you access yet.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (form.recipient_groups.length === 0) {
      setRecipientPreview(null)
      return
    }
    let cancelled = false
    setRecipientLoading(true)
    api
      .post<RecipientPreview>(`/conferences/${conferenceId}/bulk-email/recipients-preview`, { groups: form.recipient_groups })
      .then((data) => {
        if (!cancelled) setRecipientPreview(data)
      })
      .catch(() => {
        if (!cancelled) setRecipientPreview(null)
      })
      .finally(() => {
        if (!cancelled) setRecipientLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId, form.recipient_groups])

  function toggleGroup(group: RecipientGroup) {
    setForm((p) => ({
      ...p,
      recipient_groups: p.recipient_groups.includes(group) ? p.recipient_groups.filter((g) => g !== group) : [...p.recipient_groups, group],
    }))
    setContentPreview(null)
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setFormError(null)
    setContentPreview(null)
  }

  /** Validates and creates/updates the draft, returning its id (or null on failure — formError is set). Shared by "Save as draft", "Send test", and the real send, so a test or send always goes out with what's currently on screen. */
  async function saveDraft(): Promise<string | null> {
    const parsed = bulkEmailSchema.safeParse(form)
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Please check the form.')
      return null
    }
    setFormError(null)
    try {
      if (form.id) {
        await api.patch(`/conferences/${conferenceId}/bulk-email/${form.id}`, parsed.data)
        return form.id
      }
      const res = await api.post<{ id: string }>(`/conferences/${conferenceId}/bulk-email`, parsed.data)
      setForm((p) => ({ ...p, id: res.id }))
      return res.id
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this draft.')
      return null
    }
  }

  async function handleSaveDraft() {
    setSaving(true)
    try {
      const id = await saveDraft()
      if (id) {
        showToast('Draft saved.', 'success')
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handlePreviewContent() {
    const parsed = bulkEmailSchema.pick({ subject: true, body_html: true }).safeParse(form)
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Write a subject and body first.')
      return
    }
    try {
      const res = await api.post<{ subject: string; html: string }>(`/conferences/${conferenceId}/bulk-email/content-preview`, parsed.data)
      setContentPreview(res)
    } catch {
      setContentPreview(null)
    }
  }

  async function handleSendTest() {
    setTestSending(true)
    try {
      const id = await saveDraft()
      if (!id) return
      await api.post(`/conferences/${conferenceId}/bulk-email/${id}/test`)
      showToast('Test email queued — check your inbox shortly.', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not send a test email.', 'error')
    } finally {
      setTestSending(false)
    }
  }

  async function handleConfirmSend() {
    setSending(true)
    try {
      const id = await saveDraft()
      if (!id) {
        setSendConfirmOpen(false)
        return
      }
      const res = await api.post<{ recipient_count: number }>(`/conferences/${conferenceId}/bulk-email/${id}/send`)
      showToast(`Sent to ${res.recipient_count} ${res.recipient_count === 1 ? 'person' : 'people'}.`, 'success')
      setSendConfirmOpen(false)
      resetForm()
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not send this bulk email.', 'error')
      setSendConfirmOpen(false)
    } finally {
      setSending(false)
    }
  }

  async function handleEditDraft(row: BulkEmailSummary) {
    try {
      const d = await api.get<BulkEmailDetail>(`/conferences/${conferenceId}/bulk-email/${row.id}`)
      setForm({ id: d.id, subject: d.subject, body_html: d.body_html, recipient_groups: d.recipient_groups })
      setFormError(null)
      setContentPreview(null)
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not load this draft.', 'error')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    try {
      await api.del(`/conferences/${conferenceId}/bulk-email/${deleteTarget.id}`)
      showToast('Draft deleted.', 'success')
      if (form.id === deleteTarget.id) resetForm()
      setDeleteTarget(null)
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not delete this draft.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleViewDetail(row: BulkEmailSummary) {
    setDetailLoading(true)
    setDetail({ ...row, body_html: '', recipients: [] })
    try {
      const d = await api.get<BulkEmailDetail>(`/conferences/${conferenceId}/bulk-email/${row.id}`)
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const overQuota = recipientPreview !== null && recipientPreview.count > recipientPreview.remaining_today

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      <PageHeader title="Bulk email" subtitle="Send one email to everyone in a group — authors, reviewers, attendees, and more." />
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Table<BulkEmailSummary>
        loading={loading}
        rows={list}
        rowKey={(r) => r.id}
        emptyTitle="No bulk emails yet"
        emptyMessage="Compose one below — pick recipient groups, write the message, and send."
        columns={[
          {
            key: 'subject',
            header: 'Subject',
            render: (r) => (
              <button type="button" className="text-left font-medium text-text underline-offset-2 hover:underline" onClick={() => handleViewDetail(r)}>
                {r.subject}
              </button>
            ),
          },
          { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} labels={STATUS_LABELS} /> },
          {
            key: 'recipients',
            header: 'Recipients',
            render: (r) => (r.status === 'sent' ? `${r.sent_count} sent${r.failed_count > 0 ? `, ${r.failed_count} failed` : ''} of ${r.recipient_count}` : '—'),
          },
          { key: 'when', header: 'When', render: (r) => (r.sent_at ? formatKathmandu(r.sent_at) : `Draft · ${formatKathmandu(r.created_at)}`) },
          {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (r) =>
              r.status === 'draft' ? (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => handleEditDraft(r)} iconLeft={<Icon icon={Pencil} size={14} />}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(r)} disabled={busyId === r.id} iconLeft={<Icon icon={Trash2} size={14} />}>
                    Delete
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => handleViewDetail(r)} iconLeft={<Icon icon={Eye} size={14} />}>
                  View
                </Button>
              ),
          },
        ]}
      />

      <form className="rounded-lg border border-dashed border-border bg-surface p-4" onSubmit={(e) => e.preventDefault()}>
        <p className="font-medium text-text">{form.id ? 'Edit draft' : 'New bulk email'}</p>
        {formError ? (
          <div className="mt-2">
            <Alert variant="danger">{formError}</Alert>
          </div>
        ) : null}

        <div className="mt-3">
          <FormField label="Recipients">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {RECIPIENT_GROUPS.map((g) => (
                <Checkbox key={g} label={RECIPIENT_GROUP_LABELS[g]} checked={form.recipient_groups.includes(g)} onChange={() => toggleGroup(g)} />
              ))}
            </div>
          </FormField>
        </div>

        {form.recipient_groups.length > 0 ? (
          <div className="mt-2 rounded-md border border-border bg-page-bg p-3 text-sm">
            {recipientLoading ? (
              <span className="flex items-center gap-2 text-text-muted">
                <Spinner size="sm" /> Counting recipients…
              </span>
            ) : recipientPreview ? (
              <>
                <p className="text-text">
                  <strong>{recipientPreview.count}</strong> {recipientPreview.count === 1 ? 'person matches' : 'people match'} these groups (duplicates
                  removed). {recipientPreview.remaining_today} of {recipientPreview.daily_limit} emails left today.
                </p>
                {recipientPreview.preview.length > 0 ? (
                  <p className="mt-1 truncate text-xs text-text-muted">
                    {recipientPreview.preview
                      .slice(0, 8)
                      .map((p) => p.name || p.email)
                      .join(', ')}
                    {recipientPreview.count > 8 ? `, +${recipientPreview.count - 8} more` : ''}
                  </p>
                ) : null}
                {overQuota ? (
                  <div className="mt-2">
                    <Alert variant="warning">
                      This would exceed today's remaining email quota. Choose fewer recipients or send the rest tomorrow.
                    </Alert>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3">
          <FormField label="Subject">
            <Input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} placeholder="Subject" />
          </FormField>
        </div>
        <div className="mt-3">
          <FormField label="Body (HTML — p, br, strong, em, a, ul, ol, li, h2, h3 only)">
            <Textarea
              value={form.body_html}
              onChange={(e) => setForm((p) => ({ ...p, body_html: e.target.value }))}
              placeholder="Write the message. Use {{first_name}}, {{full_name}}, {{conference_name}}, {{conference_url}} to personalise."
              rows={6}
              className="font-mono text-xs"
            />
          </FormField>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={saving} loading={saving} onClick={handleSaveDraft}>
            Save as draft
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={handlePreviewContent}>
            Preview with sample data
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={testSending} loading={testSending} onClick={handleSendTest}>
            Send test to me
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={form.recipient_groups.length === 0}
            iconLeft={<Icon icon={Send} size={16} />}
            onClick={() => setSendConfirmOpen(true)}
          >
            Send
          </Button>
          {form.id ? (
            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
              Start a new one
            </Button>
          ) : null}
        </div>

        {contentPreview ? (
          <iframe
            title="Bulk email preview"
            sandbox=""
            srcDoc={contentPreview.html}
            className="mt-3 h-80 w-full rounded-md border border-border bg-surface"
          />
        ) : null}
      </form>

      <ConfirmDialog
        open={sendConfirmOpen}
        title="Send this bulk email?"
        message={
          recipientPreview
            ? `Send to ${recipientPreview.count} ${recipientPreview.count === 1 ? 'person' : 'people'}? Each person gets their own email — this can't be undone.`
            : "Send this email? Each person gets their own email — this can't be undone."
        }
        confirmLabel="Send"
        confirmVariant="primary"
        busy={sending}
        onConfirm={handleConfirmSend}
        onCancel={() => setSendConfirmOpen(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this draft?"
        message={`"${deleteTarget?.subject}" will be deleted. This can't be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        busy={busyId === deleteTarget?.id}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.subject} size="lg">
        {detailLoading ? (
          <div className="mt-4 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : detail ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <StatusChip status={detail.status} labels={STATUS_LABELS} />
              <span>
                {detail.recipient_groups.map((g) => RECIPIENT_GROUP_LABELS[g]).join(', ')} · by {detail.created_by_name}
                {detail.sent_at ? ` · sent ${formatKathmandu(detail.sent_at)}` : ''}
              </span>
            </div>
            {detail.recipients.length > 0 ? (
              <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-md border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-muted text-text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Recipient</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.recipients.map((r) => (
                      <tr key={r.recipient_email}>
                        <td className="px-3 py-2">
                          <div className="text-text">{r.recipient_name || r.recipient_email}</div>
                          <div className="text-xs text-text-muted">{r.recipient_email}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={r.delivery_status === 'failed' || r.delivery_status === 'bounced' ? 'danger' : r.delivery_status === 'sent' || r.delivery_status === 'delivered' ? 'success' : 'neutral'}>
                            {r.delivery_status ? DELIVERY_LABELS[r.delivery_status] ?? r.delivery_status : 'Unknown'}
                          </Badge>
                          {r.error_message ? <div className="mt-0.5 text-xs text-danger">{r.error_message}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-text-muted">This draft hasn't been sent yet.</p>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
