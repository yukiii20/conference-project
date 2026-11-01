import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { formatMoney } from '../../lib/money'
import { PAYMENT_METHODS, paymentSchema } from '../../lib/validation'
import { Alert, Button, FormField, Input, Modal, Select, Spinner, StatusChip } from '../ui'

type Payment = {
  id: string
  amount: string
  currency: string
  method: string
  provider_reference: string | null
  status: string
  failure_reason: string | null
  recorded_by_name: string | null
  paid_at: string | null
  created_at: string
}

type PaymentsResponse = { payments: Payment[]; amount_due: string; amount_paid: number; currency: string }

export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  esewa: 'eSewa',
  khalti: 'Khalti',
  fonepay: 'Fonepay',
  other: 'Other',
}

/**
 * Payments for one registration: what's owed, what's been paid, and a form to record a payment
 * received outside the app. Recording the payment that covers the balance confirms the
 * registration automatically (server side). Mistakes are voided, never deleted.
 */
export function PaymentsModal({
  conferenceId,
  registration,
  canManage,
  onClose,
  onChanged,
}: {
  conferenceId: string
  registration: { id: string; registration_number: string; full_name: string; status: string } | null
  canManage: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [data, setData] = useState<PaymentsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ amount: '', method: 'cash' as (typeof PAYMENT_METHODS)[number], reference: '' })
  const [saving, setSaving] = useState(false)
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [waiving, setWaiving] = useState(false)
  const [waiveReason, setWaiveReason] = useState('')

  const base = registration ? `/conferences/${conferenceId}/registrations/${registration.id}` : ''

  const load = useCallback(async () => {
    if (!base) return
    try {
      const res = await api.get<PaymentsResponse>(`${base}/payments`)
      setData(res)
      setError(null)
      const balance = Math.max(0, Number(res.amount_due) - res.amount_paid)
      setForm((p) => ({ ...p, amount: balance > 0 ? String(balance) : '' }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load payments.')
    }
  }, [base])

  useEffect(() => {
    setData(null)
    setVoidingId(null)
    setWaiving(false)
    load()
  }, [load])

  async function record(e: React.FormEvent) {
    e.preventDefault()
    const parsed = paymentSchema.safeParse(form)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid value.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.post(`${base}/payments`, parsed.data)
      setForm((p) => ({ ...p, reference: '' }))
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record this payment.')
    } finally {
      setSaving(false)
    }
  }

  async function voidPayment(id: string) {
    setSaving(true)
    setError(null)
    try {
      await api.post(`${base}/payments/${id}/void`, { reason: voidReason })
      setVoidingId(null)
      setVoidReason('')
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not void this payment.')
    } finally {
      setSaving(false)
    }
  }

  async function waive() {
    setSaving(true)
    setError(null)
    try {
      await api.post(`${base}/waive`, { reason: waiveReason })
      setWaiving(false)
      setWaiveReason('')
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not waive the fee.')
    } finally {
      setSaving(false)
    }
  }

  const due = data ? Number(data.amount_due) : 0
  const balance = data ? Math.max(0, due - data.amount_paid) : 0
  const cancelled = registration?.status === 'cancelled'

  return (
    <Modal
      open={registration !== null}
      onClose={onClose}
      title={registration ? `Payments · ${registration.registration_number}` : 'Payments'}
      description={registration?.full_name}
      size="lg"
      showClose
    >
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {!data ? (
        <div className="flex items-center gap-2 py-6 text-sm text-text-muted">
          <Spinner size="sm" /> Loading…
        </div>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-border-soft p-3">
              <dt className="text-text-muted">Due</dt>
              <dd className="mt-1 font-semibold">{due === 0 ? 'Free' : formatMoney(due, data.currency)}</dd>
            </div>
            <div className="rounded-lg border border-border-soft p-3">
              <dt className="text-text-muted">Paid</dt>
              <dd className="mt-1 font-semibold">{formatMoney(data.amount_paid, data.currency)}</dd>
            </div>
            <div className="rounded-lg border border-border-soft p-3">
              <dt className="text-text-muted">Balance</dt>
              <dd className={`mt-1 font-semibold ${balance > 0 ? 'text-danger' : 'text-success'}`}>{balance > 0 ? formatMoney(balance, data.currency) : 'Settled'}</dd>
            </div>
          </dl>

          {data.payments.length === 0 ? (
            <p className="text-sm text-text-muted">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border-soft rounded-lg border border-border-soft text-sm">
              {data.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <span className="font-medium">{formatMoney(p.amount, p.currency)}</span>{' '}
                    <span className="text-text-muted">
                      · {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method}
                      {p.provider_reference ? ` · ${p.provider_reference}` : ''}
                    </span>
                    <div className="text-xs text-text-muted">
                      {formatKathmandu(p.paid_at ?? p.created_at)}
                      {p.recorded_by_name ? ` · recorded by ${p.recorded_by_name}` : ''}
                      {p.status === 'cancelled' && p.failure_reason ? ` · voided: ${p.failure_reason}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusChip status={p.status === 'cancelled' ? 'voided' : p.status} />
                    {canManage && p.status === 'successful' ? (
                      voidingId === p.id ? (
                        <span className="flex items-center gap-1">
                          <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Why?" className="w-32" />
                          <Button size="sm" variant="secondary" disabled={saving || voidReason.trim().length < 3} onClick={() => voidPayment(p.id)}>
                            Void
                          </Button>
                          <Button size="sm" variant="link" onClick={() => setVoidingId(null)}>
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="link" className="!text-danger" onClick={() => setVoidingId(p.id)}>
                          Void
                        </Button>
                      )
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canManage && !cancelled ? (
            <form onSubmit={record} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border bg-surface p-3">
              <FormField label={`Amount (${data.currency})`}>
                <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className="w-28" />
              </FormField>
              <FormField label="Method">
                <Select value={form.method} onChange={(e) => setForm((p) => ({ ...p, method: e.target.value as typeof form.method }))} className="w-36">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Reference (optional)">
                <Input value={form.reference} onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} placeholder="Receipt / transaction no." className="w-48" />
              </FormField>
              <Button type="submit" variant="primary" loading={saving} disabled={saving}>
                Record payment
              </Button>
            </form>
          ) : null}

          {canManage && !cancelled && due > 0 ? (
            waiving ? (
              <div className="flex flex-wrap items-end gap-2">
                <FormField label="Reason for waiving the fee">
                  <Input value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="e.g. Invited speaker" className="w-64" />
                </FormField>
                <Button variant="secondary" disabled={saving || waiveReason.trim().length < 3} onClick={waive}>
                  Waive fee
                </Button>
                <Button variant="link" onClick={() => setWaiving(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="link" size="sm" onClick={() => setWaiving(true)}>
                Waive the fee instead…
              </Button>
            )
          ) : null}
        </div>
      )}
    </Modal>
  )
}
