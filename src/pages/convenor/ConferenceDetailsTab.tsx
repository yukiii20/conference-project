import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { conferenceDetailsSchema, portalTextsSchema, type ConferenceDetailsInput } from '../../lib/validation'
import { useToast } from '../../components/ui/Toast'
import { Alert, Button, Input, Spinner, Textarea } from '../../components/ui'
import { Icon } from '../../components/ui/Icon'

type ConferenceDetailsData = {
  slug: string
  name: string
  short_name: string | null
  theme: string | null
  description: string | null
  start_date: string
  end_date: string
  contact_email: string | null
  contact_phone: string | null
  website_url: string | null
  tagline: string | null
  primary_color: string | null
  banner_path: string | null
  welcome_text: string | null
  submission_guidelines: string | null
}

function fieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in errors)) errors[key] = issue.message
  }
  return errors
}

function PortalTextsSection({ conferenceId, data }: { conferenceId: string; data: ConferenceDetailsData }) {
  const [welcomeText, setWelcomeText] = useState(data.welcome_text ?? '')
  const [guidelines, setGuidelines] = useState(data.submission_guidelines ?? '')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const { showToast } = useToast()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const parsed = portalTextsSchema.safeParse({ welcome_text: welcomeText, submission_guidelines: guidelines })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
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

  return (
    <div className="mt-10 max-w-2xl border-t border-border pt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text">Portal texts</h2>
        {data.slug ? (
          <a
            href={`/c/${data.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            Preview public page
          </a>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-text-muted">
        Shown on the public submission page. Plain text only — line breaks are kept, and any https:// link becomes
        clickable, but no formatting or HTML is rendered.
      </p>

      <form onSubmit={handleSave} className="mt-4 space-y-4">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="welcome_text" className="block text-sm font-medium text-text">
              Welcome text
            </label>
            <span className="text-xs text-text-muted">{welcomeText.length} / 3000</span>
          </div>
          <Textarea
            id="welcome_text"
            value={welcomeText}
            onChange={(e) => setWelcomeText(e.target.value)}
            maxLength={3000}
            rows={4}
            placeholder="Welcome to the submission page for... Please create an account to submit your abstract."
            className="mt-1"
            error={Boolean(errors.welcome_text)}
          />
          {errors.welcome_text ? <p className="mt-1 text-sm text-danger">{errors.welcome_text}</p> : null}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="guidelines" className="block text-sm font-medium text-text">
              Submission guidelines
            </label>
            <span className="text-xs text-text-muted">{guidelines.length} / 10000</span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            The word limit, allowed file types, max file size, and review mode are shown automatically above this text
            — no need to repeat them here.
          </p>
          <Textarea
            id="guidelines"
            value={guidelines}
            onChange={(e) => setGuidelines(e.target.value)}
            maxLength={10000}
            rows={10}
            className="mt-1"
            error={Boolean(errors.submission_guidelines)}
          />
          {errors.submission_guidelines ? <p className="mt-1 text-sm text-danger">{errors.submission_guidelines}</p> : null}
        </div>

        <Button type="submit" loading={saving} iconLeft={<Icon icon={Save} size={16} />}>
          Save
        </Button>
      </form>
    </div>
  )
}

type FormState = {
  name: string
  short_name: string
  theme: string
  description: string
  start_date: string
  end_date: string
  contact_email: string
  contact_phone: string
  website_url: string
}

function toFormState(data: ConferenceDetailsData): FormState {
  return {
    name: data.name ?? '',
    short_name: data.short_name ?? '',
    theme: data.theme ?? '',
    description: data.description ?? '',
    start_date: data.start_date ?? '',
    end_date: data.end_date ?? '',
    contact_email: data.contact_email ?? '',
    contact_phone: data.contact_phone ?? '',
    website_url: data.website_url ?? '',
  }
}

export function ConferenceDetailsTab({ conferenceId }: { conferenceId: string }) {
  const [data, setData] = useState<ConferenceDetailsData | null>(null)
  const [code, setCode] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const res = await api.get<{ conference: ConferenceDetailsData & { code: string } }>(
          `/conferences/${conferenceId}/details`,
        )
        if (cancelled) return
        setData(res.conference)
        setCode(res.conference.code ?? '')
        setForm(toFormState(res.conference))
        setLoadError(null)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load conference details.')
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
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form) return

    const parsed = conferenceDetailsSchema.safeParse(form as ConferenceDetailsInput)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
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

  if (loadError || !data || !form) {
    return <Alert variant="danger">{loadError ?? 'Could not load conference details.'}</Alert>
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="mt-6 max-w-2xl space-y-4">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}
        <div>
          <label className="block text-sm font-medium text-text">Conference code</label>
          <p className="mt-1 rounded-md border border-border bg-page-bg px-3 py-2 text-text-muted">{code}</p>
          <p className="mt-1 text-xs text-text-muted">Used in sign-up and the public page. Not editable here.</p>
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-text">
            Name
          </label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="mt-1"
            error={Boolean(errors.name)}
          />
          {errors.name ? <p className="mt-1 text-sm text-danger">{errors.name}</p> : null}
        </div>

        <div>
          <label htmlFor="short_name" className="block text-sm font-medium text-text">
            Short name
          </label>
          <Input
            id="short_name"
            value={form.short_name}
            onChange={(e) => update('short_name', e.target.value)}
            className="mt-1"
            error={Boolean(errors.short_name)}
          />
          {errors.short_name ? <p className="mt-1 text-sm text-danger">{errors.short_name}</p> : null}
        </div>

        <div>
          <label htmlFor="theme" className="block text-sm font-medium text-text">
            Theme
          </label>
          <Input
            id="theme"
            value={form.theme}
            onChange={(e) => update('theme', e.target.value)}
            className="mt-1"
            error={Boolean(errors.theme)}
          />
          {errors.theme ? <p className="mt-1 text-sm text-danger">{errors.theme}</p> : null}
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-text">
            About the conference
          </label>
          <Textarea
            id="description"
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            rows={6}
            className="mt-1"
            error={Boolean(errors.description)}
          />
          {errors.description ? <p className="mt-1 text-sm text-danger">{errors.description}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="start_date" className="block text-sm font-medium text-text">
              Start date
            </label>
            <Input
              id="start_date"
              type="date"
              value={form.start_date}
              onChange={(e) => update('start_date', e.target.value)}
              className="mt-1"
              error={Boolean(errors.start_date)}
            />
            {errors.start_date ? <p className="mt-1 text-sm text-danger">{errors.start_date}</p> : null}
          </div>
          <div>
            <label htmlFor="end_date" className="block text-sm font-medium text-text">
              End date
            </label>
            <Input
              id="end_date"
              type="date"
              value={form.end_date}
              onChange={(e) => update('end_date', e.target.value)}
              className="mt-1"
              error={Boolean(errors.end_date)}
            />
            {errors.end_date ? <p className="mt-1 text-sm text-danger">{errors.end_date}</p> : null}
          </div>
        </div>

        <div>
          <label htmlFor="contact_email" className="block text-sm font-medium text-text">
            Contact email
          </label>
          <Input
            id="contact_email"
            type="email"
            value={form.contact_email}
            onChange={(e) => update('contact_email', e.target.value)}
            className="mt-1"
            error={Boolean(errors.contact_email)}
          />
          {errors.contact_email ? <p className="mt-1 text-sm text-danger">{errors.contact_email}</p> : null}
        </div>

        <div>
          <label htmlFor="contact_phone" className="block text-sm font-medium text-text">
            Contact phone
          </label>
          <Input
            id="contact_phone"
            value={form.contact_phone}
            onChange={(e) => update('contact_phone', e.target.value)}
            placeholder="98XXXXXXXX"
            className="mt-1"
            error={Boolean(errors.contact_phone)}
          />
          {errors.contact_phone ? <p className="mt-1 text-sm text-danger">{errors.contact_phone}</p> : null}
        </div>

        <div>
          <label htmlFor="website_url" className="block text-sm font-medium text-text">
            Website
          </label>
          <Input
            id="website_url"
            value={form.website_url}
            onChange={(e) => update('website_url', e.target.value)}
            placeholder="https://"
            className="mt-1"
            error={Boolean(errors.website_url)}
          />
          {errors.website_url ? <p className="mt-1 text-sm text-danger">{errors.website_url}</p> : null}
        </div>

        <Button type="submit" loading={saving} iconLeft={<Icon icon={Save} size={16} />}>
          Save
        </Button>
      </form>

      <PortalTextsSection conferenceId={conferenceId} data={data} />
    </>
  )
}
