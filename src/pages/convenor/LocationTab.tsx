import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { locationSchema, type LocationInput } from '../../lib/validation'
import { useToast } from '../../components/ui/Toast'

type FormState = {
  venue_name: string
  address: string
  city: string
  country: string
  location_map_url: string
}

const EMPTY_FORM: FormState = {
  venue_name: '',
  address: '',
  city: '',
  country: '',
  location_map_url: '',
}

export function LocationTab({ conferenceId }: { conferenceId: string }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const res = await api.get<{
          conference: {
            venue_name: string | null
            address: string | null
            city: string | null
            country: string | null
            location_map_url: string | null
          }
        }>(`/conferences/${conferenceId}/details`)
        if (cancelled) return
        const data = res.conference
        setForm({
          venue_name: data.venue_name ?? '',
          address: data.address ?? '',
          city: data.city ?? '',
          country: data.country ?? '',
          location_map_url: data.location_map_url ?? '',
        })
      } catch (err) {
        if (cancelled) return
        setFormError(err instanceof ApiError ? err.message : 'Could not load the location.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const parsed = locationSchema.safeParse(form as LocationInput)
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) {
          nextErrors[key] = issue.message
        }
      }
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSaving(true)

    try {
      await api.patch(`/conferences/${conferenceId}`, parsed.data)
      showToast('Saved.', 'success')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save this.'
      setFormError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  return (
    <div className="mt-6 grid max-w-4xl gap-8 md:grid-cols-2">
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {formError}
          </div>
        ) : null}
<div>
          <label htmlFor="venue_name" className="block text-sm font-medium text-ink">
            Venue
          </label>
          <input
            id="venue_name"
            value={form.venue_name}
            onChange={(e) => update('venue_name', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.venue_name ? <p className="mt-1 text-sm text-red-600">{errors.venue_name}</p> : null}
        </div>

        <div>
          <label htmlFor="address" className="block text-sm font-medium text-ink">
            Address
          </label>
          <input
            id="address"
            value={form.address}
            onChange={(e) => update('address', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.address ? <p className="mt-1 text-sm text-red-600">{errors.address}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="city" className="block text-sm font-medium text-ink">
              City
            </label>
            <input
              id="city"
              value={form.city}
              onChange={(e) => update('city', e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
            />
            {errors.city ? <p className="mt-1 text-sm text-red-600">{errors.city}</p> : null}
          </div>
          <div>
            <label htmlFor="country" className="block text-sm font-medium text-ink">
              Country code
            </label>
            <input
              id="country"
              value={form.country}
              onChange={(e) => update('country', e.target.value)}
              maxLength={2}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 uppercase focus:border-button"
            />
            {errors.country ? <p className="mt-1 text-sm text-red-600">{errors.country}</p> : null}
          </div>
        </div>

        <div>
          <label htmlFor="location_map_url" className="block text-sm font-medium text-ink">
            Google Maps embed URL
          </label>
          <input
            id="location_map_url"
            value={form.location_map_url}
            onChange={(e) => update('location_map_url', e.target.value)}
            placeholder="https://www.google.com/maps/embed?..."
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          <p className="mt-1 text-xs text-ink/50">
            In Google Maps: Share → Embed a map → copy the src="..." URL from the code.
          </p>
          {errors.location_map_url ? <p className="mt-1 text-sm text-red-600">{errors.location_map_url}</p> : null}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>

      <div>
        <p className="mb-2 text-sm font-medium text-ink">Live preview</p>
        {form.location_map_url && /^https:\/\//i.test(form.location_map_url) ? (
          <iframe
            src={form.location_map_url}
            title="Venue location map"
            loading="lazy"
            className="h-80 w-full rounded-lg border border-line"
          />
        ) : (
          <div className="flex h-80 w-full items-center justify-center rounded-lg border border-dashed border-line bg-white text-sm text-ink/50">
            Paste an embed URL to see a preview
          </div>
        )}
      </div>
    </div>
  )
}
