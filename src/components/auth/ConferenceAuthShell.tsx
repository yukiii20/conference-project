import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, MapPin, SearchX } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { resolveConferenceBrand, type ConferenceBrand } from '../../lib/color'
import { publicImageUrl } from '../../lib/storage'
import { SITE } from '../../content/site'
import { Button } from '../ui/Button'
import { Skeleton } from '../ui/Spinner'

/** The public fields a branded sign-in page needs (from GET /api/conferences/:slug). */
export type BrandedConference = {
  id: string
  slug: string
  name: string
  short_name: string | null
  tagline: string | null
  logo_path: string | null
  primary_color: string | null
  start_date: string | null
  end_date: string | null
  city: string | null
  country: string | null
}

export type ConferenceLoadState =
  | { status: 'loading' }
  | { status: 'ready'; conference: BrandedConference }
  | { status: 'not_found' }
  | { status: 'error'; message: string }

/**
 * Loads a published conference by slug. Unknown, unpublished (draft) and
 * deleted conferences all come back 404 from the public endpoint, which is
 * reported as `not_found` — never as a generic error.
 */
export function useConferenceBySlug(slug: string | undefined): { state: ConferenceLoadState; retry: () => void } {
  const [state, setState] = useState<ConferenceLoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const trimmed = slug?.trim()
    if (!trimmed) {
      setState({ status: 'not_found' })
      return
    }
    setState({ status: 'loading' })
    api
      .get<{ conference: BrandedConference }>(`/conferences/${encodeURIComponent(trimmed)}`)
      .then((data) => {
        if (cancelled) return
        setState(data?.conference ? { status: 'ready', conference: data.conference } : { status: 'not_found' })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) setState({ status: 'not_found' })
        else setState({ status: 'error', message: err instanceof ApiError ? err.message : "Can't reach the server. Check your connection." })
      })
    return () => {
      cancelled = true
    }
  }, [slug, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, retry }
}

export function conferenceAuthPath(slug: string, page: 'login' | 'signup' | 'forgot-password' | 'reset-password'): string {
  return `/c/${encodeURIComponent(slug)}/${page}`
}

/**
 * Scoped re-theming: the shared design tokens (--color-button, ...) are
 * overridden on the page wrapper only, so every <Button>, <Input> focus ring
 * and link inside picks up the conference's colour without touching the
 * shared UI components. The colour has already been validated as #rrggbb by
 * resolveConferenceBrand (anything else falls back to the platform default).
 *
 * The two rules below cover what a token can't: the primary button hard-codes
 * white text (wrong on a light conference colour), and outline/link text
 * needs a shade dark enough to read on white. The selectors and values are
 * static — only CSS variables carry the conference's colour.
 */
const BRAND_SCOPE_CSS = `
[data-conference-brand] .bg-button.text-white { color: var(--conference-on-color); }
[data-conference-brand] .text-button { color: var(--conference-text); }
[data-conference-brand] .conference-link { color: var(--conference-text); }
`

export function brandStyle(brand: ConferenceBrand): CSSProperties {
  return {
    '--color-button': brand.color,
    '--color-button-hover': brand.hover,
    '--color-button-active': brand.active,
    '--color-outline-hover': brand.tint,
    '--color-indigo-soft': brand.tint,
    '--conference-on-color': brand.onColor,
    '--conference-text': brand.text,
  } as CSSProperties
}

/** Wraps children in the conference's colours (tokens + the two scoped rules). */
export function ConferenceBrandScope({ brand, children, className = '' }: { brand: ConferenceBrand; children: ReactNode; className?: string }) {
  return (
    <div data-conference-brand="" style={brandStyle(brand)} className={className}>
      <style>{BRAND_SCOPE_CSS}</style>
      {children}
    </div>
  )
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null
  const fmt = (value: string) => {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const a = fmt(start)
  const b = end ? fmt(end) : null
  if (!a) return null
  return b && b !== a ? `${a} – ${b}` : a
}

function ConferenceLogo({ conference, brand, size }: { conference: BrandedConference; brand: ConferenceBrand; size: 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false)
  const logoUrl = failed ? null : publicImageUrl(conference.logo_path)
  const box = size === 'lg' ? 'h-16 w-16 rounded-2xl' : 'h-11 w-11 rounded-xl'
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${conference.name} logo`}
        onError={() => setFailed(true)}
        className={`${box} flex-shrink-0 bg-white object-contain p-1.5 shadow-sm ring-1 ring-black/5`}
      />
    )
  }
  // No logo: the name is shown as text next to this initial, never an empty box.
  return (
    <span
      aria-hidden="true"
      className={`${box} flex flex-shrink-0 items-center justify-center font-display font-semibold ${size === 'lg' ? 'text-2xl' : 'text-lg'}`}
      style={
        size === 'lg'
          ? { backgroundColor: 'rgb(255 255 255 / 0.14)', color: brand.onColor, boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.2)' }
          : { backgroundColor: brand.color, color: brand.onColor }
      }
    >
      {conference.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/**
 * Frame for a conference's own account pages (/c/:slug/login, /signup,
 * /forgot-password, /reset-password): the conference's logo, name and
 * colour on the left from lg up, the form on the right. On small screens the
 * logo and name sit above the form.
 */
export function ConferenceAuthShell({
  conference,
  title,
  subtitle,
  children,
  footer,
  wide = false,
  centered = false,
}: {
  conference: BrandedConference
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  centered?: boolean
}) {
  const brand = resolveConferenceBrand(conference.primary_color)
  const dates = formatDateRange(conference.start_date, conference.end_date)
  const place = [conference.city, conference.country].filter(Boolean).join(', ')
  const conferenceHref = `/c/${encodeURIComponent(conference.slug)}`

  return (
    <ConferenceBrandScope brand={brand} className="flex min-h-screen bg-page-bg">
      <aside
        className="relative hidden w-[44%] max-w-[640px] flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ backgroundColor: brand.color, color: brand.onColor }}
      >
        <div
          className="absolute inset-0 opacity-15 [background-image:radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] [background-size:20px_20px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
          aria-hidden="true"
        />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />

        <Link to={conferenceHref} className="relative flex items-center gap-2 text-sm font-medium opacity-85 hover:opacity-100">
          <ArrowLeft size={16} aria-hidden="true" />
          Conference home
        </Link>

        <div className="relative">
          <ConferenceLogo conference={conference} brand={brand} size="lg" />
          <p className="mt-6 font-display text-4xl font-semibold leading-tight tracking-tight">{conference.name}</p>
          {conference.tagline ? <p className="mt-3 max-w-md text-lg leading-relaxed opacity-80">{conference.tagline}</p> : null}
          <ul className="mt-8 space-y-3 text-sm opacity-90">
            {dates ? (
              <li className="flex items-center gap-2.5">
                <CalendarDays size={18} aria-hidden="true" />
                {dates}
              </li>
            ) : null}
            {place ? (
              <li className="flex items-center gap-2.5">
                <MapPin size={18} aria-hidden="true" />
                {place}
              </li>
            ) : null}
          </ul>
        </div>

        <p className="relative text-sm opacity-60">
          Powered by{' '}
          <Link to="/" className="underline-offset-4 hover:underline">
            {SITE.name}
          </Link>
        </p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-4 sm:px-8">
          <Link
            to={conferenceHref}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-text-muted hover:bg-surface-muted/50 hover:text-text"
          >
            <ArrowLeft size={16} aria-hidden="true" className="flex-shrink-0" />
            <span className="truncate">{conference.short_name || conference.name}</span>
          </Link>
        </div>

        <div className="flex flex-1 items-start justify-center px-4 pb-12 pt-2 sm:items-center sm:px-8 sm:pt-0">
          <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'}`}>
            <div className={centered ? 'text-center' : ''}>
              <div className={`mb-6 items-center gap-3 lg:hidden ${centered ? 'inline-flex' : 'flex'}`}>
                <ConferenceLogo conference={conference} brand={brand} size="sm" />
                <span className="min-w-0 text-left font-display text-lg font-semibold leading-snug text-text">{conference.name}</span>
              </div>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-text">{title}</h1>
              {subtitle ? <p className="mt-2 text-text-muted">{subtitle}</p> : null}
            </div>
            <div className="mt-8 rounded-2xl border border-border-soft bg-surface p-6 shadow-card sm:p-8">{children}</div>
            {footer ? <div className="mt-6 text-center text-sm text-text-muted">{footer}</div> : null}
          </div>
        </div>
      </main>
    </ConferenceBrandScope>
  )
}

/** Shown while the conference loads — same frame, neutral colours. */
export function ConferenceAuthLoading() {
  return (
    <div className="flex min-h-screen bg-page-bg" aria-busy="true" aria-live="polite">
      <aside className="hidden w-[44%] max-w-[640px] bg-surface-muted lg:block" />
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4">
          <span className="sr-only">Loading conference…</span>
          <Skeleton className="h-11 w-48" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </main>
    </div>
  )
}

/** Unknown, unpublished or deleted slug. */
export function ConferenceNotFound({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page-bg px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border-soft bg-surface p-8 text-center shadow-card">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-muted">
            <SearchX size={22} aria-hidden="true" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-semibold text-text">Conference not found</h1>
          <p className="mt-2 text-sm text-text-muted">
            We couldn't find this conference. The link may be wrong, or the conference isn't open to the public.
          </p>
          <Link to="/login" className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-button px-4 text-sm font-medium text-white hover:bg-button-hover">
            See the list of conferences
          </Link>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ConferenceLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page-bg px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border-soft bg-surface p-8 text-center shadow-card">
        <h1 className="font-display text-2xl font-semibold text-text">Something went wrong</h1>
        <p className="mt-2 text-sm text-text-muted" role="alert">
          {message}
        </p>
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

/**
 * Renders the right state for a /c/:slug/... account page: loading,
 * not found, load error, or the page itself with the loaded conference.
 */
export function WithConference({
  slug,
  children,
  notFoundExtra,
}: {
  slug: string | undefined
  children: (conference: BrandedConference) => ReactNode
  notFoundExtra?: ReactNode
}) {
  const { state, retry } = useConferenceBySlug(slug)
  if (state.status === 'loading') return <ConferenceAuthLoading />
  if (state.status === 'not_found') return <ConferenceNotFound>{notFoundExtra}</ConferenceNotFound>
  if (state.status === 'error') return <ConferenceLoadError message={state.message} onRetry={retry} />
  return <>{children(state.conference)}</>
}

/**
 * For pages reached from an emailed link (reset password, set password) that
 * may carry a conference: branded when the slug names a published conference,
 * otherwise the plain platform frame — the link keeps working either way
 * (e.g. an invitation to a conference that isn't published yet).
 */
export function BrandedOrPlainShell({
  slug,
  plain,
  branded,
}: {
  slug: string | null | undefined
  plain: () => ReactNode
  branded: (conference: BrandedConference) => ReactNode
}) {
  const { state } = useConferenceBySlug(slug ?? undefined)
  if (!slug) return <>{plain()}</>
  if (state.status === 'loading') return <ConferenceAuthLoading />
  if (state.status === 'ready') return <>{branded(state.conference)}</>
  return <>{plain()}</>
}
