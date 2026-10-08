import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  conferenceDetailsSchema,
  brandingSchema,
  portalTextsSchema,
  type ConferenceDetailsInput,
} from '../../lib/validation'
import { imageExtension } from '../../lib/storage'
import { DEFAULT_CONFERENCE_COLOR } from '../../lib/color'
import { ImageUpload } from '../../components/ImageUpload'

const MAX_BANNER_MB = 3

function PortalTextsSection({ conferenceId }: { conferenceId: string }) {
  const [slug, setSlug] = useState('')
  const [welcomeText, setWelcomeText] = useState('')
  const [guidelines, setGuidelines] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('conferences')
        .select('slug, welcome_text, submission_guidelines')
        .eq('id', conferenceId)
        .single()
      if (cancelled) return
      if (error) {
        setFormError(error.message)
      } else if (data) {
        setSlug(data.slug ?? '')
        setWelcomeText(data.welcome_text ?? '')
        setGuidelines(data.submission_guidelines ?? '')
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaved(false)
    const parsed = portalTextsSchema.safeParse({ welcome_text: welcomeText, submission_guidelines: guidelines })
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) nextErrors[key] = issue.message
      }
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSaving(true)
    const { error } = await supabase.from('conferences').update(parsed.data).eq('id', conferenceId)
    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setSaved(true)
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  return (
    <div className="mt-10 max-w-2xl border-t border-line pt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Portal texts</h2>
        {slug ? (
          <a
            href={`/c/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background"
          >
            Preview public page
          </a>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink/60">
        Shown on the public submission page. Plain text only — line breaks are kept, and any https:// link becomes
        clickable, but no formatting or HTML is rendered.
      </p>

      <form onSubmit={handleSave} className="mt-4 space-y-4">
        {formError ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {formError}
          </div>
        ) : null}
        {saved ? (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Saved.</div>
        ) : null}

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="welcome_text" className="block text-sm font-medium text-ink">
              Welcome text
            </label>
            <span className="text-xs text-ink/50">{welcomeText.length} / 3000</span>
          </div>
          <textarea
            id="welcome_text"
            value={welcomeText}
            onChange={(e) => {
              setWelcomeText(e.target.value)
              setSaved(false)
            }}
            maxLength={3000}
            rows={4}
            placeholder="Welcome to the submission page for... Please create an account to submit your abstract."
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.welcome_text ? <p className="mt-1 text-sm text-red-600">{errors.welcome_text}</p> : null}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="guidelines" className="block text-sm font-medium text-ink">
              Submission guidelines
            </label>
            <span className="text-xs text-ink/50">{guidelines.length} / 10000</span>
          </div>
          <p className="mt-1 text-xs text-ink/50">
            The word limit, allowed file types, max file size, and review mode are shown automatically above this text
            — no need to repeat them here.
          </p>
          <textarea
            id="guidelines"
            value={guidelines}
            onChange={(e) => {
              setGuidelines(e.target.value)
              setSaved(false)
            }}
            maxLength={10000}
            rows={10}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.submission_guidelines ? <p className="mt-1 text-sm text-red-600">{errors.submission_guidelines}</p> : null}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  )
}

function BrandingSection({ conferenceId }: { conferenceId: string }) {
  const [slug, setSlug] = useState('')
  const [tagline, setTagline] = useState('')
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_CONFERENCE_COLOR)
  const [bannerPath, setBannerPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('conferences')
        .select('slug, tagline, primary_color, banner_path')
        .eq('id', conferenceId)
        .single()
      if (cancelled) return
      if (error) {
        setFormError(error.message)
      } else if (data) {
        setSlug(data.slug ?? '')
        setTagline(data.tagline ?? '')
        setPrimaryColor(data.primary_color ?? DEFAULT_CONFERENCE_COLOR)
        setBannerPath(data.banner_path)
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaved(false)
    const parsed = brandingSchema.safeParse({ tagline, primary_color: primaryColor })
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in nextErrors)) nextErrors[key] = issue.message
      }
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSaving(true)
    const { error } = await supabase.from('conferences').update(parsed.data).eq('id', conferenceId)
    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setSaved(true)
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  return (
    <div className="mt-10 max-w-2xl border-t border-line pt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Branding</h2>
        {slug ? (
          <a
            href={`/c/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-background"
          >
            View public page
          </a>
        ) : null}
      </div>

      <form onSubmit={handleSave} className="mt-4 space-y-4">
        {formError ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {formError}
          </div>
        ) : null}
        {saved ? (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Saved.</div>
        ) : null}

        <div>
          <label htmlFor="tagline" className="block text-sm font-medium text-ink">
            Tagline
          </label>
          <input
            id="tagline"
            value={tagline}
            onChange={(e) => {
              setTagline(e.target.value)
              setSaved(false)
            }}
            maxLength={200}
            placeholder="A short line shown under the conference name"
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.tagline ? <p className="mt-1 text-sm text-red-600">{errors.tagline}</p> : null}
        </div>

        <div>
          <label htmlFor="primary_color" className="block text-sm font-medium text-ink">
            Primary colour
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_CONFERENCE_COLOR}
              onChange={(e) => {
                setPrimaryColor(e.target.value)
                setSaved(false)
              }}
              className="h-10 w-14 rounded-md border border-line"
            />
            <input
              id="primary_color"
              value={primaryColor}
              onChange={(e) => {
                setPrimaryColor(e.target.value)
                setSaved(false)
              }}
              placeholder="#2747A0"
              className="flex-1 rounded-md border border-line px-3 py-2 font-mono uppercase focus:border-button"
            />
          </div>
          {errors.primary_color ? <p className="mt-1 text-sm text-red-600">{errors.primary_color}</p> : null}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>

      <div className="mt-6">
        <p className="text-sm font-medium text-ink">Banner image</p>
        <p className="mt-1 text-xs text-ink/50">PNG, JPG, or WEBP, up to {MAX_BANNER_MB} MB. Shown behind the conference name.</p>
        <div className="mt-2">
          <ImageUpload
            label="banner"
            currentPath={bannerPath}
            maxSizeMB={MAX_BANNER_MB}
            aspect="wide"
            buildPath={(file) => `conferences/${conferenceId}/banner-${crypto.randomUUID()}.${imageExtension(file.type)}`}
            onSaved={async (path) => {
              const { error } = await supabase.from('conferences').update({ banner_path: path }).eq('id', conferenceId)
              if (error) return error.message
              setBannerPath(path)
              return null
            }}
            onRemoved={async () => {
              const { error } = await supabase.from('conferences').update({ banner_path: null }).eq('id', conferenceId)
              if (error) return error.message
              setBannerPath(null)
              return null
            }}
          />
        </div>
      </div>
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

const EMPTY_FORM: FormState = {
  name: '',
  short_name: '',
  theme: '',
  description: '',
  start_date: '',
  end_date: '',
  contact_email: '',
  contact_phone: '',
  website_url: '',
}

export function ConferenceDetailsTab({ conferenceId }: { conferenceId: string }) {
  const [code, setCode] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('conferences')
        .select('code, name, short_name, theme, description, start_date, end_date, contact_email, contact_phone, website_url')
        .eq('id', conferenceId)
        .single()

      if (cancelled) return

      if (error) {
        setFormError(error.message)
      } else if (data) {
        setCode(data.code ?? '')
        setForm({
          name: data.name ?? '',
          short_name: data.short_name ?? '',
          theme: data.theme ?? '',
          description: data.description ?? '',
          start_date: data.start_date ?? '',
          end_date: data.end_date ?? '',
          contact_email: data.contact_email ?? '',
          contact_phone: data.contact_phone ?? '',
          website_url: data.website_url ?? '',
        })
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaved(false)

    const parsed = conferenceDetailsSchema.safeParse(form as ConferenceDetailsInput)
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

    const { error } = await supabase.from('conferences').update(parsed.data).eq('id', conferenceId)
    setSaving(false)

    if (error) {
      setFormError(error.message)
      return
    }
    setSaved(true)
  }

  if (loading) {
    return <p className="mt-6 text-sm text-ink/60">Loading…</p>
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="mt-6 max-w-2xl space-y-4">
      {formError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {formError}
        </div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Saved.</div>
      ) : null}

      <div>
        <label className="block text-sm font-medium text-ink">Conference code</label>
        <p className="mt-1 rounded-md border border-line bg-background px-3 py-2 text-ink/70">{code}</p>
        <p className="mt-1 text-xs text-ink/50">Used in sign-up and the public page. Not editable here.</p>
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-ink">
          Name
        </label>
        <input
          id="name"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.name ? <p className="mt-1 text-sm text-red-600">{errors.name}</p> : null}
      </div>

      <div>
        <label htmlFor="short_name" className="block text-sm font-medium text-ink">
          Short name
        </label>
        <input
          id="short_name"
          value={form.short_name}
          onChange={(e) => update('short_name', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.short_name ? <p className="mt-1 text-sm text-red-600">{errors.short_name}</p> : null}
      </div>

      <div>
        <label htmlFor="theme" className="block text-sm font-medium text-ink">
          Theme
        </label>
        <input
          id="theme"
          value={form.theme}
          onChange={(e) => update('theme', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.theme ? <p className="mt-1 text-sm text-red-600">{errors.theme}</p> : null}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-ink">
          About the conference
        </label>
        <textarea
          id="description"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          rows={6}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.description ? <p className="mt-1 text-sm text-red-600">{errors.description}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="start_date" className="block text-sm font-medium text-ink">
            Start date
          </label>
          <input
            id="start_date"
            type="date"
            value={form.start_date}
            onChange={(e) => update('start_date', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.start_date ? <p className="mt-1 text-sm text-red-600">{errors.start_date}</p> : null}
        </div>
        <div>
          <label htmlFor="end_date" className="block text-sm font-medium text-ink">
            End date
          </label>
          <input
            id="end_date"
            type="date"
            value={form.end_date}
            onChange={(e) => update('end_date', e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
          />
          {errors.end_date ? <p className="mt-1 text-sm text-red-600">{errors.end_date}</p> : null}
        </div>
      </div>

      <div>
        <label htmlFor="contact_email" className="block text-sm font-medium text-ink">
          Contact email
        </label>
        <input
          id="contact_email"
          type="email"
          value={form.contact_email}
          onChange={(e) => update('contact_email', e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.contact_email ? <p className="mt-1 text-sm text-red-600">{errors.contact_email}</p> : null}
      </div>

      <div>
        <label htmlFor="contact_phone" className="block text-sm font-medium text-ink">
          Contact phone
        </label>
        <input
          id="contact_phone"
          value={form.contact_phone}
          onChange={(e) => update('contact_phone', e.target.value)}
          placeholder="98XXXXXXXX"
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.contact_phone ? <p className="mt-1 text-sm text-red-600">{errors.contact_phone}</p> : null}
      </div>

      <div>
        <label htmlFor="website_url" className="block text-sm font-medium text-ink">
          Website
        </label>
        <input
          id="website_url"
          value={form.website_url}
          onChange={(e) => update('website_url', e.target.value)}
          placeholder="https://"
          className="mt-1 w-full rounded-md border border-line px-3 py-2 focus:border-button"
        />
        {errors.website_url ? <p className="mt-1 text-sm text-red-600">{errors.website_url}</p> : null}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </form>

    <BrandingSection conferenceId={conferenceId} />
    <PortalTextsSection conferenceId={conferenceId} />
    </>
  )
}
