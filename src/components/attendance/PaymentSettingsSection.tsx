import { useCallback, useEffect, useRef, useState } from 'react'
import { Save, Upload } from 'lucide-react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { Alert, Button, FormField, Spinner, Textarea } from '../ui'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'

/** changes-nov2, Part 6: Attendance -> payment instructions and an optional payment QR image, shown on the form for paid categories. */
type Settings = { payment_instructions: string | null; has_qr: boolean }

export function PaymentSettingsSection({ conferenceId }: { conferenceId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'upload' | 'remove' | null>(null)
  const [qrVersion, setQrVersion] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  const load = useCallback(async () => {
    try {
      const res = await api.get<Settings>(`/conferences/${conferenceId}/payment-settings`)
      setSettings(res)
      setText(res.payment_instructions ?? '')
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the payment settings.')
    }
  }, [conferenceId])

  useEffect(() => {
    load()
  }, [load])

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<unknown>, success: string) {
    setBusy(kind)
    setError(null)
    try {
      await action()
      showToast(success, 'success')
      setQrVersion((v) => v + 1)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mt-10" data-testid="payment-settings">
      <h2 className="font-display text-xl font-semibold text-brand">Payment instructions</h2>
      <p className="mt-1 text-sm text-text-muted">
        Shown on the registration form for paid categories. Participants then upload a receipt (JPG, PNG or PDF), and you confirm or reject it in the
        Registrations list below.
      </p>
      {error ? (
        <div className="mt-3">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}
      {!settings ? (
        error ? null : (
          <div className="mt-3 flex items-center gap-2 text-sm text-text-muted">
            <Spinner size="sm" /> Loading…
          </div>
        )
      ) : (
        <div className="mt-3 grid gap-6 md:grid-cols-[1fr_auto]">
          <div>
            <FormField label="Instructions (plain text)" htmlFor="payment-instructions" help="For example: bank name, account name and number, eSewa/Khalti ID.">
              <Textarea id="payment-instructions" rows={6} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
            </FormField>
            <Button
              type="button"
              className="mt-3"
              loading={busy === 'save'}
              disabled={(settings.payment_instructions ?? '') === text}
              onClick={() => run('save', () => api.put(`/conferences/${conferenceId}/payment-settings`, { payment_instructions: text.trim() || null }), 'Payment instructions saved.')}
              iconLeft={<Icon icon={Save} size={16} />}
            >
              Save instructions
            </Button>
          </div>
          <div>
            <p className="text-sm font-medium text-text">Payment QR (optional)</p>
            {settings.has_qr ? (
              <img
                src={`${API_BASE}/conferences/${conferenceId}/payment-info/qr?v=${qrVersion}`}
                alt="Payment QR code"
                className="mt-2 h-40 w-40 rounded-md border border-border bg-white object-contain"
              />
            ) : (
              <p className="mt-2 text-sm text-text-muted">No QR image.</p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              aria-label="Upload payment QR image"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const form = new FormData()
                form.append('file', f)
                run('upload', () => api.upload(`/conferences/${conferenceId}/payment-settings/qr`, form), 'Payment QR uploaded.')
              }}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" loading={busy === 'upload'} onClick={() => fileRef.current?.click()} iconLeft={<Icon icon={Upload} size={14} />}>
                {settings.has_qr ? 'Replace' : 'Upload'}
              </Button>
              {settings.has_qr ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={busy === 'remove'}
                  onClick={() => run('remove', () => api.del(`/conferences/${conferenceId}/payment-settings/qr`), 'Payment QR removed.')}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-text-muted">PNG or JPG, up to 2 MB.</p>
          </div>
        </div>
      )}
    </section>
  )
}
