import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { brandingSchema } from '../../lib/validation'
import { DEFAULT_CONFERENCE_COLOR, darken, getAccessibleTextColor, hexToRgba } from '../../lib/color'
import { publicImageUrl } from '../../lib/storage'
import { ImageUpload } from '../../components/ImageUpload'
import { useToast } from '../../components/ui/Toast'
import { Alert, Button, Input, Spinner } from '../../components/ui'

const MAX_LOGO_MB = 2
const MAX_BANNER_MB = 3

type LogoTabData = {
  slug: string
  name: string
  code: string
  tagline: string | null
  primary_color: string | null
  logo_path: string | null
  banner_path: string | null
}

function fieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in errors)) errors[key] = issue.message
  }
  return errors
}

function LivePreview({
  name,
  code,
  tagline,
  color,
  logoUrl,
  bannerUrl,
}: {
  name: string
  code: string
  tagline: string
  color: string
  logoUrl: string | null
  bannerUrl: string | null
}) {
  const accent = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_CONFERENCE_COLOR
  const textColor = bannerUrl ? '#ffffff' : getAccessibleTextColor(accent)

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl border border-line shadow-sm">
      <div
        className="relative flex items-center gap-3 px-4 py-6"
        style={{ backgroundColor: bannerUrl ? undefined : accent }}
      >
        {bannerUrl ? (
          <>
            <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0" style={{ backgroundColor: hexToRgba(darken(accent, 0.75), 0.65) }} />
          </>
        ) : null}
        <div className="relative flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-9 w-9 shrink-0 rounded bg-white/90 object-contain p-0.5" />
          ) : (
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white/90 text-xs font-semibold"
              style={{ color: accent }}
            >
              {code || '--'}
            </span>
          )}
          <div className="min-w-0" style={{ color: textColor }}>
            <p className="truncate text-sm font-semibold">{name || 'Conference name'}</p>
            {tagline ? <p className="truncate text-xs opacity-90">{tagline}</p> : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-white px-4 py-2 text-xs">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
        <span style={{ color: accent }} className="font-medium">
          Buttons and links use this colour
        </span>
      </div>
    </div>
  )
}

export function LogoTab({ conferenceId }: { conferenceId: string }) {
  const [data, setData] = useState<LogoTabData | null>(null)
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [bannerPath, setBannerPath] = useState<string | null>(null)
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_CONFERENCE_COLOR)
  const [tagline, setTagline] = useState('')
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
        const res = await api.get<{ conference: LogoTabData }>(`/conferences/${conferenceId}/details`)
        if (cancelled) return
        setData(res.conference)
        setLogoPath(res.conference.logo_path)
        setBannerPath(res.conference.banner_path)
        setPrimaryColor(res.conference.primary_color ?? DEFAULT_CONFERENCE_COLOR)
        setTagline(res.conference.tagline ?? '')
        setLoadError(null)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load branding.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [conferenceId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const parsed = brandingSchema.safeParse({ tagline, primary_color: primaryColor })
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

  if (loadError || !data) {
    return <Alert variant="danger">{loadError ?? 'Could not load branding.'}</Alert>
  }

  return (
    <div className="mt-6 flex flex-col gap-10 lg:flex-row">
      <div className="max-w-md flex-1 space-y-8">
        <div>
          <p className="text-sm font-medium text-text">Logo</p>
          <p className="mt-1 text-xs text-text-muted">
            Square image, up to {MAX_LOGO_MB} MB. Shown top-left on the conference page.
          </p>
          <div className="mt-2">
            <ImageUpload
              label="logo"
              currentPath={logoPath}
              maxSizeMB={MAX_LOGO_MB}
              aspect="square"
              uploadUrl={`/api/conferences/${conferenceId}/logo`}
              removeUrl={`/api/conferences/${conferenceId}/logo`}
              onSaved={setLogoPath}
              onRemoved={() => setLogoPath(null)}
            />
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4 border-t border-border pt-6">
          {formError ? <Alert variant="danger">{formError}</Alert> : null}
          <div>
            <label htmlFor="tagline" className="block text-sm font-medium text-text">
              Tagline
            </label>
            <Input
              id="tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              maxLength={200}
              placeholder="A short line shown under the conference name"
              className="mt-1"
              error={Boolean(errors.tagline)}
            />
            {errors.tagline ? <p className="mt-1 text-sm text-danger">{errors.tagline}</p> : null}
          </div>

          {/* Colour-picker control: a deliberate per-conference branding feature, kept byte-for-byte. */}
          <div>
            <label htmlFor="primary_color" className="block text-sm font-medium text-text">
              Primary colour
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_CONFERENCE_COLOR}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-14 rounded-md border border-line"
              />
              <input
                id="primary_color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#2747A0"
                className="flex-1 rounded-md border border-line px-3 py-2 font-mono uppercase focus:border-button"
              />
            </div>
            {errors.primary_color ? <p className="mt-1 text-sm text-danger">{errors.primary_color}</p> : null}
            <p className="mt-1 text-xs text-text-muted">Used for buttons, links, and the conference page background.</p>
          </div>

          <Button type="submit" loading={saving}>
            Save
          </Button>
        </form>

        <div className="border-t border-border pt-6">
          <p className="text-sm font-medium text-text">Banner image</p>
          <p className="mt-1 text-xs text-text-muted">
            PNG, JPG, or WEBP, up to {MAX_BANNER_MB} MB. Shown behind the conference name.
          </p>
          <div className="mt-2">
            <ImageUpload
              label="banner"
              currentPath={bannerPath}
              maxSizeMB={MAX_BANNER_MB}
              aspect="wide"
              uploadUrl={`/api/conferences/${conferenceId}/banner`}
              removeUrl={`/api/conferences/${conferenceId}/banner`}
              onSaved={setBannerPath}
              onRemoved={() => setBannerPath(null)}
            />
          </div>
        </div>
      </div>

      <div className="flex-1">
        <p className="text-sm font-medium text-text">Live preview</p>
        <div className="mt-2">
          <LivePreview
            name={data.name}
            code={data.code}
            tagline={tagline}
            color={primaryColor}
            logoUrl={publicImageUrl(logoPath)}
            bannerUrl={publicImageUrl(bannerPath)}
          />
        </div>
      </div>
    </div>
  )
}
