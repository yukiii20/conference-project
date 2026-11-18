import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { Badge, StatusChip } from '../ui/Badge'
import type { StatusTone } from '../../lib/status'
import { ConfirmDialog, Modal } from '../ui/Modal'
import { Table, Pagination } from '../ui/Table'
import type { Column } from '../ui/Table'
import { Alert, Button, FormField, Input, Select, Textarea } from '../ui'
import { formatMoney } from '../../lib/money'
import { PaymentsModal } from './PaymentsModal'

type Category = { id: string; name: string }

type AdminRegistration = {
  id: string
  registration_number: string
  full_name: string
  email: string
  category_name: string
  status: 'pending' | 'confirmed' | 'waitlisted' | 'cancelled'
  amount_due: string
  amount_paid: string
  currency: string
  registered_at: string
  /** Holds the active Audience role in this conference. */
  is_audience?: number | boolean
  // changes-nov2, Part 6: payment receipt
  has_receipt?: number | boolean
  receipt_original_name?: string | null
  receipt_mime_type?: string | null
  receipt_amount?: string | null
  receipt_paid_on?: string | null
  receipt_reference?: string | null
  receipt_uploaded_at?: string | null
  rejection_reason?: string | null
  rejected_at?: string | null
}

type ReceiptState = 'awaiting_receipt' | 'pending_confirmation' | 'rejected' | null

/** Only a pending registration has a receipt state; "Pending confirmation" = pending with a receipt. */
function receiptState(r: AdminRegistration): ReceiptState {
  if (r.status !== 'pending') return null
  if (r.rejected_at) return 'rejected'
  return r.has_receipt ? 'pending_confirmation' : 'awaiting_receipt'
}

const RECEIPT_LABELS: Record<NonNullable<ReceiptState>, { text: string; tone: StatusTone }> = {
  awaiting_receipt: { text: 'Awaiting receipt', tone: 'neutral' },
  pending_confirmation: { text: 'Pending confirmation', tone: 'warning' },
  rejected: { text: 'Rejected', tone: 'danger' },
}

function paymentSummary(r: AdminRegistration): { text: string; owing: boolean } {
  const due = Number(r.amount_due)
  const paid = Number(r.amount_paid ?? 0)
  if (due === 0) return { text: paid > 0 ? `${formatMoney(paid, r.currency)} paid` : 'Free', owing: false }
  if (paid >= due) return { text: `${formatMoney(due, r.currency)} · paid`, owing: false }
  return { text: `${formatMoney(paid, r.currency)} of ${formatMoney(due, r.currency)}`, owing: r.status !== 'cancelled' }
}

/**
 * Shared by the convenor/manager Attendance tab (full control) and the
 * staff "Registrations" view (read-only — no confirm/cancel, same search,
 * status and category filters, same CSV export).
 */
export function RegistrationsList({
  conferenceId,
  readOnly = false,
  initialStatus = '',
}: {
  conferenceId: string
  readOnly?: boolean
  /** Pre-selects the status filter — e.g. the convenor dashboard's "Pending registrations" attention item links here with `pending`, so the convenor lands straight on the ones that need confirming. */
  initialStatus?: string
}) {
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [categoryId, setCategoryId] = useState('')
  const [audience, setAudience] = useState<'' | 'only' | 'without'>('')
  const [payment, setPayment] = useState<'' | NonNullable<ReceiptState>>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [rejecting, setRejecting] = useState<AdminRegistration | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  useEffect(() => {
    api
      .get<{ categories: Category[] }>(`/conferences/${conferenceId}/registration-categories`)
      .then((data) => setCategories(data.categories))
      .catch(() => setCategories([]))
  }, [conferenceId])

  // Debounced so typing doesn't fire a request per keystroke - the input
  // itself stays instantly responsive via `search`, only the API call waits.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query: Record<string, string | undefined> = { page: String(page) }
      if (debouncedSearch) query.search = debouncedSearch
      if (status) query.status = status
      if (categoryId) query.category_id = categoryId
      if (audience) query.audience = audience
      if (payment) query.payment = payment
      const data = await api.get<{ registrations: AdminRegistration[]; page: number; page_size: number; total: number }>(
        `/conferences/${conferenceId}/registrations`,
        query,
      )
      setRegistrations(data.registrations)
      setSelected(new Set())
      setTotal(data.total)
      setPageSize(data.page_size)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load registrations.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, debouncedSearch, status, categoryId, audience, payment, page])

  useEffect(() => {
    load()
  }, [load])

  // Any filter change invalidates the current page - go back to page 1 rather
  // than risk landing past the end of a now-smaller result set.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, status, categoryId, audience, payment])

  async function confirmRegistration(id: string) {
    setBusyId(id)
    try {
      await api.patch(`/conferences/${conferenceId}/registrations/${id}/confirm`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm this registration.')
    } finally {
      setBusyId(null)
    }
  }

  async function bulkConfirm() {
    setBulkConfirming(false)
    setBusyId('bulk')
    try {
      const res = await api.post<{ confirmed: number; failed: Array<{ id: string; message: string }> }>(
        `/conferences/${conferenceId}/registrations/bulk-confirm`,
        { registration_ids: [...selected] },
      )
      setNotice(`${res.confirmed} confirmed${res.failed.length ? `, ${res.failed.length} could not be confirmed` : ''}.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm the selected registrations.')
    } finally {
      setBusyId(null)
    }
  }

  async function rejectReceipt() {
    if (!rejecting) return
    setBusyId(rejecting.id)
    try {
      await api.post(`/conferences/${conferenceId}/registrations/${rejecting.id}/reject`, { reason: rejectReason.trim() })
      setNotice(`Receipt for ${rejecting.registration_number} rejected. The participant was emailed the reason.`)
      setRejecting(null)
      setRejectReason('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reject this receipt.')
    } finally {
      setBusyId(null)
    }
  }

  function toggleSelected(id: string) {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null)
  const [paymentsFor, setPaymentsFor] = useState<AdminRegistration | null>(null)

  async function cancelRegistration(id: string) {
    setConfirmingCancelId(null)
    setBusyId(id)
    try {
      await api.del(`/conferences/${conferenceId}/registrations/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel this registration.')
    } finally {
      setBusyId(null)
    }
  }

  const columns: Column<AdminRegistration>[] = [
    ...(readOnly
      ? []
      : [
          {
            key: 'select',
            header: '',
            render: (r: AdminRegistration) =>
              r.status === 'pending' ? (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.registration_number}`}
                  checked={selected.has(r.id)}
                  onChange={() => toggleSelected(r.id)}
                  className="h-4 w-4"
                />
              ) : null,
          },
        ]),
    { key: 'number', header: 'Number', render: (r) => <span className="font-mono text-xs">{r.registration_number}</span> },
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <>
          {r.full_name}
          {r.is_audience ? (
            <span className="ml-1.5 rounded-full bg-indigo-soft px-1.5 py-0.5 text-[11px] font-medium text-button">Audience</span>
          ) : null}
          <div className="text-xs text-text-muted">{r.email}</div>
        </>
      ),
    },
    { key: 'category', header: 'Category', render: (r) => r.category_name },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
    {
      key: 'payment',
      header: 'Payment',
      render: (r) => {
        const s = paymentSummary(r)
        return <span className={`whitespace-nowrap text-sm ${s.owing ? 'text-danger' : 'text-text-muted'}`}>{s.text}</span>
      },
    },
    {
      key: 'receipt',
      header: 'Receipt',
      render: (r) => {
        const state = receiptState(r)
        if (!state && !r.has_receipt) return <span className="text-xs text-text-muted">—</span>
        return (
          <div className="min-w-[10rem] text-xs" data-testid="receipt-cell">
            {state ? (
              <Badge tone={RECEIPT_LABELS[state].tone}>{RECEIPT_LABELS[state].text}</Badge>
            ) : null}
            {r.has_receipt ? (
              <div className="mt-1 space-y-0.5 text-text-muted">
                {readOnly ? null : (
                <a
                  href={`${API_BASE}/conferences/${conferenceId}/registrations/${r.id}/receipt`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-button hover:underline"
                >
                  View receipt{r.receipt_mime_type === 'application/pdf' ? ' (PDF)' : ''}
                </a>
                )}
                <div>
                  {r.receipt_amount != null ? formatMoney(Number(r.receipt_amount), r.currency) : ''}
                  {r.receipt_paid_on ? ` · ${formatKathmandu(r.receipt_paid_on, { dateOnly: true })}` : ''}
                </div>
                {r.receipt_reference ? <div className="break-all">Ref: {r.receipt_reference}</div> : null}
              </div>
            ) : null}
            {state === 'rejected' && r.rejection_reason ? <div className="mt-1 text-danger">Reason: {r.rejection_reason}</div> : null}
          </div>
        )
      },
    },
    { key: 'registered', header: 'Registered', render: (r) => formatKathmandu(r.registered_at), className: 'whitespace-nowrap' },
    ...(readOnly
      ? []
      : [
          {
            key: 'actions',
            header: '',
            render: (r: AdminRegistration) => (
              <div className="flex gap-2">
                <Button type="button" variant="link" size="sm" onClick={() => setPaymentsFor(r)}>
                  Payments
                </Button>
                {r.status === 'pending' ? (
                  <Button type="button" variant="link" size="sm" disabled={busyId === r.id} onClick={() => confirmRegistration(r.id)}>
                    Confirm
                  </Button>
                ) : null}
                {receiptState(r) === 'pending_confirmation' ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="!text-danger"
                    disabled={busyId === r.id}
                    onClick={() => {
                      setRejectReason('')
                      setRejecting(r)
                    }}
                  >
                    Reject
                  </Button>
                ) : null}
                {r.status !== 'cancelled' ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="!text-danger"
                    disabled={busyId === r.id}
                    onClick={() => setConfirmingCancelId(r.id)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ),
          },
        ]),
  ]

  return (
    <div>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {notice ? (
        <div className="mt-3">
          <Alert variant="success">{notice}</Alert>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or number"
          className="min-w-[220px] flex-1"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-auto">
          <option value="">Any category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={audience}
          onChange={(e) => setAudience(e.target.value as '' | 'only' | 'without')}
          className="w-auto"
          aria-label="Audience filter"
        >
          <option value="">Everyone</option>
          <option value="only">Audience only</option>
          <option value="without">Not in Audience</option>
        </Select>
        <Select
          value={payment}
          onChange={(e) => setPayment(e.target.value as '' | NonNullable<ReceiptState>)}
          className="w-auto"
          aria-label="Receipt filter"
        >
          <option value="">Any receipt</option>
          <option value="awaiting_receipt">Awaiting receipt</option>
          <option value="pending_confirmation">Pending confirmation</option>
          <option value="rejected">Rejected</option>
        </Select>
        <a
          href={`${API_BASE}/conferences/${conferenceId}/registrations/export.csv`}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-button px-4 py-2 text-sm font-medium text-button hover:bg-outline-hover"
        >
          Export CSV
        </a>
      </div>

      {!readOnly && selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          <Button type="button" size="sm" loading={busyId === 'bulk'} onClick={() => setBulkConfirming(true)}>
            Confirm selected
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      <div className="mt-3">
        <Table
          columns={columns}
          rows={registrations}
          rowKey={(r) => r.id}
          loading={loading}
          emptyTitle="No registrations yet."
          minWidth={900}
        />
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />

      <PaymentsModal
        conferenceId={conferenceId}
        registration={paymentsFor}
        canManage={!readOnly}
        onClose={() => setPaymentsFor(null)}
        onChanged={load}
      />

      <ConfirmDialog
        open={confirmingCancelId !== null}
        title="Cancel this registration?"
        message="The attendee will need to register again if they still want to attend."
        confirmLabel="Cancel registration"
        busy={busyId === confirmingCancelId}
        onConfirm={() => confirmingCancelId && cancelRegistration(confirmingCancelId)}
        onCancel={() => setConfirmingCancelId(null)}
      />

      <ConfirmDialog
        open={bulkConfirming}
        title={`Confirm ${selected.size} ${selected.size === 1 ? 'registration' : 'registrations'}?`}
        message="Each person gets the Registration confirmed email with their QR ticket. Check the receipts first."
        confirmLabel="Confirm all"
        confirmVariant="primary"
        busy={busyId === 'bulk'}
        onConfirm={bulkConfirm}
        onCancel={() => setBulkConfirming(false)}
      />

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Reject this receipt?"
        description={rejecting ? `${rejecting.full_name} · ${rejecting.registration_number}` : undefined}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={rejecting !== null && busyId === rejecting.id}
              disabled={rejectReason.trim().length < 3}
              onClick={rejectReceipt}
            >
              Reject receipt
            </Button>
          </>
        }
      >
        <FormField label="Reason (emailed to the participant)" htmlFor="reject-reason">
          <Textarea id="reject-reason" rows={3} maxLength={500} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        </FormField>
        <p className="mt-2 text-xs text-text-muted">They can upload a new receipt, which puts the registration back to Pending confirmation.</p>
      </Modal>
    </div>
  )
}
