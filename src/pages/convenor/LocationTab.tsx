import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { locationSchema, type LocationInput } from '../../lib/validation'
import { useToast } from '../../components/ui/Toast'
import { PageHeader, FormField, Input, Button, Alert, Spinner } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'

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
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  return (
    <div className="mt-6 max-w-4xl">
      <PageHeader title="Location" subtitle="Venue details and the map shown on the public conference page." />
      <div className="grid gap-8 md:grid-cols-2">
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <FormField label="Venue" htmlFor="venue_name" error={errors.venue_name}>
          <Input id="venue_name" value={form.venue_name} onChange={(e) => update('venue_name', e.target.value)} error={Boolean(errors.venue_name)} />
        </FormField>

        <FormField label="Address" htmlFor="address" error={errors.address}>
          <Input id="address" value={form.address} onChange={(e) => update('address', e.target.value)} error={Boolean(errors.address)} />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="City" htmlFor="city" error={errors.city}>
            <Input id="city" value={form.city} onChange={(e) => update('city', e.target.value)} error={Boolean(errors.city)} />
          </FormField>
          <FormField label="Country code" htmlFor="country" error={errors.country}>
            <Input
              id="country"
              value={form.country}
              onChange={(e) => update('country', e.target.value)}
              maxLength={2}
              className="uppercase"
              error={Boolean(errors.country)}
            />
          </FormField>
        </div>

        <FormField
          label="Google Maps embed URL"
          htmlFor="location_map_url"
          error={errors.location_map_url}
          help={errors.location_map_url ? undefined : 'In Google Maps: Share → Embed a map → copy the src="..." URL from the code.'}
        >
          <Input
            id="location_map_url"
            value={form.location_map_url}
            onChange={(e) => update('location_map_url', e.target.value)}
            placeholder="https://www.google.com/maps/embed?..."
            error={Boolean(errors.location_map_url)}
          />
        </FormField>

        <Button type="submit" variant="primary" disabled={saving} loading={saving} iconLeft={<Icon icon={Save} size={16} />}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>

      <div>
        <p className="mb-2 text-sm font-medium text-text">Live preview</p>
        {form.location_map_url && /^https:\/\//i.test(form.location_map_url) ? (
          <iframe
            src={form.location_map_url}
            title="Venue location map"
            loading="lazy"
            className="h-80 w-full rounded-lg border border-border"
          />
        ) : (
          <div className="flex h-80 w-full items-center justify-center rounded-lg border border-dashed border-border bg-surface text-sm text-text-muted">
            Paste an embed URL to see a preview
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
