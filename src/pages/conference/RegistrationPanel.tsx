import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { useAuth } from '../../lib/authContext'
import { ConfirmDialog } from '../../components/ui/Modal'

type Category = { id: string; code: string; name: string; is_active: boolean }
type MyRegistration = {
  id: string
  registration_number: string
  status: 'pending' | 'confirmed' | 'waitlisted' | 'cancelled'
  category_name: string
  registered_at: string
}
type MyCertificate = {
  id: string
  certificate_type: string
  certificate_number: string
  status: string
}

const STATUS_NOTE: Record<MyRegistration['status'], string> = {
  pending: 'Your registration is awaiting payment confirmation from the organisers.',
  confirmed: 'You are registered to attend.',
  waitlisted: "You're on the waitlist.",
  cancelled: 'This registration was cancelled.',
}

export function RegistrationPanel({ conferenceId, accent }: { conferenceId: string; accent: string }) {
  const { user, loading: authLoading, refresh } = useAuth()
  const [registration, setRegistration] = useState<MyRegistration | null>(null)
  const [certificates, setCertificates] = useState<MyCertificate[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    refresh()
  }, [refresh])

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [regData, certData] = await Promise.all([
        api.get<{ registration: MyRegistration | null }>(`/conferences/${conferenceId}/my-registration`),
        api.get<{ certificates: MyCertificate[] }>(`/conferences/${conferenceId}/my-certificates`),
      ])
      setRegistration(regData.registration)
      setCertificates(certData.certificates)
      if (!regData.registration) {
        const catData = await api.get<{ categories: Category[] }>(`/conferences/${conferenceId}/registration-categories`)
        setCategories(catData.categories.filter((c) => c.is_active))
      }
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your registration.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, user])

  useEffect(() => {
    if (!authLoading) load()
  }, [authLoading, load])

  async function register() {
    if (!categoryId) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/conferences/${conferenceId}/register`, { category_id: categoryId })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not register you for this conference.')
    } finally {
      setBusy(false)
    }
  }

  const [confirmingCancel, setConfirmingCancel] = useState(false)

  async function cancel() {
    setConfirmingCancel(false)
    setBusy(true)
    setError(null)
    try {
      await api.del(`/conferences/${conferenceId}/my-registration`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel your registration.')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || loading) {
    return <p className="text-sm text-ink/60">Loading…</p>
  }

  if (!user) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/70">
        <Link to="/login" style={{ color: accent }} className="font-medium underline">
          Sign in
        </Link>{' '}
        to register to attend this conference.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!registration ? (
        categories.length === 0 ? (
          <p className="text-sm text-ink/60">Registration is not open yet.</p>
        ) : (
          <div className="rounded-lg border border-line bg-white p-5">
            <p className="text-sm font-medium text-ink">Register to attend</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-button"
              >
                <option value="">Choose a category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={register}
                disabled={busy || !categoryId}
                style={{ backgroundColor: accent }}
                className="rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Registering…' : 'Register to attend'}
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="rounded-lg border border-line bg-white p-5">
          <p className="text-sm font-medium text-ink">Your ticket</p>
          <p className="mt-2 font-mono text-lg">{registration.registration_number}</p>
          <p className="mt-1 text-sm text-ink/70">{registration.category_name}</p>
          <p className="mt-1 text-sm text-ink/60">{STATUS_NOTE[registration.status]}</p>

          {registration.status !== 'cancelled' ? (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <img
                src={`${API_BASE}/conferences/${conferenceId}/my-registration/qr.png`}
                alt="Your check-in QR code"
                className="h-36 w-36 rounded-md border border-line"
              />
              <div className="space-y-2">
                <a
                  href={`${API_BASE}/conferences/${conferenceId}/my-registration/qr.png`}
                  download="ticket-qr.png"
                  className="block rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background"
                >
                  Download QR (PNG)
                </a>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(true)}
                  disabled={busy}
                  className="block min-h-10 rounded-md border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel registration
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel your registration?"
        message="You can register again later if space is still available."
        confirmLabel="Cancel registration"
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setConfirmingCancel(false)}
      />

      {certificates.length > 0 ? (
        <div className="rounded-lg border border-line bg-white p-5">
          <p className="text-sm font-medium text-ink">Your certificates</p>
          <ul className="mt-2 space-y-1">
            {certificates.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {c.certificate_type} <span className="font-mono text-xs text-ink/50">{c.certificate_number}</span>
                </span>
                {c.status === 'issued' ? (
                  <a
                    href={`${API_BASE}/conferences/${conferenceId}/certificates/${c.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: accent }}
                    className="font-medium hover:underline"
                  >
                    Download
                  </a>
                ) : (
                  <span className="text-ink/50">Revoked</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {registration ? (
        <p className="text-xs text-ink/50">Registered {formatKathmandu(registration.registered_at)}</p>
      ) : null}
    </div>
  )
}
