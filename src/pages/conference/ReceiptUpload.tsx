import { useEffect, useState, type FormEvent } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { kathmanduToday } from '../../lib/datetime'

/** changes-nov2, Part 6: payment instructions (+ QR) and the participant's receipt upload form. */

export type PaymentInfo = { payment_instructions: string | null; has_qr: boolean }

export function usePaymentInfo(conferenceId: string): PaymentInfo | null {
  const [info, setInfo] = useState<PaymentInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    api
      .get<PaymentInfo>(`/conferences/${conferenceId}/payment-info/public`)
      .then((r) => {
        if (!cancelled) setInfo(r)
      })
      .catch(() => {
        // Optional: without it the form simply shows no instructions.
      })
    return () => {
      cancelled = true
    }
  }, [conferenceId])
  return info
}

export function PaymentInstructions({ conferenceId, info }: { conferenceId: string; info: PaymentInfo | null }) {
  if (!info || (!info.payment_instructions && !info.has_qr)) return null
  return (
    <div className="mt-3 rounded-md border border-line bg-background px-4 py-3 text-sm" data-testid="payment-instructions">
      <p className="font-medium text-ink">How to pay</p>
      {info.payment_instructions ? <p className="mt-1 whitespace-pre-line text-ink/80">{info.payment_instructions}</p> : null}
      {info.has_qr ? (
        <img
          src={`${API_BASE}/conferences/${conferenceId}/payment-info/qr`}
          alt="Payment QR code"
          className="mt-3 h-40 w-40 rounded-md border border-line bg-white object-contain"
        />
      ) : null}
    </div>
  )
}

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = ['image/jpeg', 'image/png', 'application/pdf']

export function ReceiptUploadForm({
  conferenceId,
  accent,
  defaultAmount,
  onUploaded,
}: {
  conferenceId: string
  accent: string
  defaultAmount?: string
  onUploaded: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [amount, setAmount] = useState(defaultAmount ?? '')
  const [paidOn, setPaidOn] = useState('')
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!file) next.file = 'Choose your receipt file.'
    else if (!ACCEPT.includes(file.type)) next.file = 'Upload a JPG, PNG or PDF file.'
    else if (file.size > MAX_BYTES) next.file = 'The receipt must be 5 MB or smaller.'
    if (amount.trim() === '' || Number.isNaN(Number(amount)) || Number(amount) < 0) next.amount = 'Enter the amount you paid.'
    if (!paidOn) next.paid_on = 'Enter the payment date.'
    if (!reference.trim()) next.reference = 'Enter the payment reference or transaction ID.'
    setErrors(next)
    setMessage(null)
    if (Object.keys(next).length > 0) return

    const form = new FormData()
    form.append('amount', amount.trim())
    form.append('paid_on', paidOn)
    form.append('reference', reference.trim())
    form.append('file', file!)
    setBusy(true)
    try {
      await api.upload(`/conferences/${conferenceId}/my-registration/receipt`, form)
      onUploaded()
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields ?? {})
        setMessage(err.message)
      } else {
        setMessage('Could not upload your receipt. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const field = 'mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button'
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-red-600">{errors[k]}</p> : null)

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-3 rounded-md border border-line p-4" data-testid="receipt-form">
      <p className="text-sm font-medium text-ink">Upload your payment receipt</p>
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      <div>
        <label htmlFor="receipt-file" className="text-xs font-medium text-ink/70">
          Receipt (JPG, PNG or PDF, up to 5 MB)
        </label>
        <input
          id="receipt-file"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
        />
        {err('file')}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="receipt-amount" className="text-xs font-medium text-ink/70">
            Amount paid
          </label>
          <input id="receipt-amount" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
          {err('amount')}
        </div>
        <div>
          <label htmlFor="receipt-date" className="text-xs font-medium text-ink/70">
            Payment date
          </label>
          <input id="receipt-date" type="date" max={kathmanduToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={field} />
          {err('paid_on')}
        </div>
        <div>
          <label htmlFor="receipt-ref" className="text-xs font-medium text-ink/70">
            Reference / transaction ID
          </label>
          <input id="receipt-ref" type="text" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} className={field} />
          {err('reference')}
        </div>
      </div>
      <button
        type="submit"
        disabled={busy}
        style={{ backgroundColor: accent }}
        className="rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Uploading…' : 'Upload receipt'}
      </button>
    </form>
  )
}
