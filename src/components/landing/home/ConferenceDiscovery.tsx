import { useState, memo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, MapPin, Search, Ticket, X } from 'lucide-react'
import { publicImageUrl } from '../../../lib/storage'
import { DEFAULT_CONFERENCE_COLOR, darken } from '../../../lib/color'
import { formatDateRange } from '../../../lib/datetime'
import { SITE } from '../../../content/site'
import { Reveal } from '../Reveal'
import { ConferenceLogo } from './HomeHero'
import {
  countryName,
  daysUntil,
  placeLabel,
  shortDate,
  STATUS_LABELS,
  todayDateString,
  windowState,
  type Conference,
  type DeadlineWindow,
  type TabId,
} from './homeData'

type Windows = { abstracts: Map<string, DeadlineWindow>; registration: Map<string, DeadlineWindow> }

function Media({ conference, past, tall }: { conference: Conference; past: boolean; tall?: boolean }) {
  const accent = conference.primary_color ?? DEFAULT_CONFERENCE_COLOR
  const banner = publicImageUrl(conference.banner_path)
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative overflow-hidden ${tall ? 'h-48 lg:h-full lg:min-h-[320px]' : 'h-36'} ${past ? 'grayscale-[0.55]' : ''}`}>
      {banner && !failed ? (
        <img
          src={banner}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
        />
      ) : (
        <div
          className="h-full w-full transition-transform duration-700 ease-out group-hover:scale-[1.05]"
          style={{ backgroundImage: `linear-gradient(135deg, ${accent} 0%, ${darken(accent, 0.45)} 100%)` }}
        >
          <div className="absolute inset-0 opacity-[0.18] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:16px_16px]" />
          <span className="absolute -bottom-6 right-3 select-none font-display text-[6.5rem] font-semibold leading-none text-white/10" aria-hidden="true">
            {conference.short_name || conference.code}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" aria-hidden="true" />
    </div>
  )
}

function AvailabilityLine({ label, window, kind }: { label: string; window: DeadlineWindow | undefined; kind: 'abstracts' | 'registration' }) {
  const state = windowState(window)
  if (state === 'none' || !window) return null
  let text: string
  let tone: string
  if (state === 'open') {
    const left = window.closes_at ? daysUntil(window.closes_at) : null
    text = window.closes_at ? `${label} open · closes ${shortDate(window.closes_at)}${left !== null && left <= 30 ? ` (${left}d left)` : ''}` : `${label} open`
    tone = 'text-success'
  } else if (state === 'upcoming') {
    text = `${label} open ${shortDate(window.opens_at)}`
    tone = 'text-gold-ink'
  } else {
    text = `${label} closed`
    tone = 'text-text-muted'
  }
  return (
    <p className={`flex items-center gap-2 text-[13px] font-medium ${tone}`}>
      {kind === 'abstracts' ? (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${state === 'open' ? 'bg-success' : state === 'upcoming' ? 'bg-gold' : 'bg-border-strong'}`} aria-hidden="true" />
      ) : (
        <Ticket size={13} aria-hidden="true" className="shrink-0" />
      )}
      {text}
    </p>
  )
}

function ConferenceCard({ conference: c, windows, featured }: { conference: Conference; windows: Windows; featured?: boolean }) {
  const past = c.end_date < todayDateString()
  const place = placeLabel(c)
  const where = [c.venue_name, place].filter(Boolean).join(' · ')
  const abstractsOpen = windowState(windows.abstracts.get(c.id)) === 'open'
  const statusLabel = past ? 'Past conference' : abstractsOpen ? 'Open for abstracts' : (STATUS_LABELS[c.status] ?? c.status)
  const chipTone = past ? 'bg-white/85 text-text-muted' : abstractsOpen ? 'bg-success text-white' : 'bg-white/90 text-brand'

  return (
    <Link
      to={`/c/${c.slug}`}
      aria-label={`${c.name} — view conference`}
      className={`group flex h-full overflow-hidden rounded-[22px] border border-border-soft bg-surface shadow-card transition duration-300 ease-out hover:-translate-y-1.5 hover:border-border hover:shadow-[0_24px_48px_-24px_rgb(16_28_50/0.35)] ${
        featured ? 'flex-col lg:grid lg:grid-cols-[1.1fr_1fr]' : 'flex-col'
      }`}
    >
      <div className="relative">
        <Media conference={c} past={past} tall={featured} />
        <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide shadow-sm backdrop-blur ${chipTone}`}>
          {featured ? 'Featured · ' : ''}
          {statusLabel}
        </span>
        {c.code ? (
          <span className="absolute right-3 top-3 rounded-md bg-black/25 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-white/90 backdrop-blur-sm">
            {c.code}
          </span>
        ) : null}
      </div>

      <div className={`relative flex flex-1 flex-col px-5 pb-5 ${featured ? 'lg:justify-center lg:p-8' : ''}`}>
        <ConferenceLogo
          conference={c}
          className={`relative z-10 h-14 w-14 rounded-2xl border-4 border-surface text-base shadow-sm ${featured ? '-mt-7 lg:mt-0' : '-mt-7'}`}
        />
        <h3 className={`mt-3 font-display font-semibold leading-snug text-text ${featured ? 'text-2xl lg:text-[1.75rem]' : 'line-clamp-2 text-lg'}`}>{c.name}</h3>
        {c.theme || c.tagline ? (
          <p className={`mt-1 text-sm text-text-muted ${featured ? 'line-clamp-3' : 'line-clamp-2'}`}>{c.theme || c.tagline}</p>
        ) : null}

        <dl className="mt-4 space-y-1.5 text-[13px] text-text-muted">
          <div className="flex items-center gap-2">
            <dt className="sr-only">Dates</dt>
            <CalendarDays size={14} aria-hidden="true" className="shrink-0 text-brand/70" />
            <dd>{formatDateRange(c.start_date, c.end_date)}</dd>
          </div>
          {where ? (
            <div className="flex items-center gap-2">
              <dt className="sr-only">Location</dt>
              <MapPin size={14} aria-hidden="true" className="shrink-0 text-brand/70" />
              <dd className="truncate">{where}</dd>
            </div>
          ) : null}
        </dl>

        {!past ? (
          <div className="mt-4 space-y-1.5 border-t border-border-soft pt-4">
            <AvailabilityLine label="Abstracts" window={windows.abstracts.get(c.id)} kind="abstracts" />
            <AvailabilityLine label="Registration" window={windows.registration.get(c.id)} kind="registration" />
          </div>
        ) : null}

        <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-brand">
          View conference
          <ArrowRight size={15} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  )
}

function SkeletonCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-[22px] border border-border-soft bg-surface">
      <div className="h-36 bg-surface-muted" />
      <div className="px-5 pb-5">
        <div className="relative -mt-7 h-14 w-14 rounded-2xl border-4 border-surface bg-surface-muted" />
        <div className="mt-4 h-5 w-3/4 rounded bg-surface-muted" />
        <div className="mt-2 h-3 w-1/2 rounded bg-surface-muted" />
        <div className="mt-6 h-3 w-2/3 rounded bg-surface-muted" />
        <div className="mt-2 h-3 w-1/3 rounded bg-surface-muted" />
      </div>
    </div>
  )
}

export const ConferenceDiscovery = memo(function ConferenceDiscovery({
  conferences,
  windows,
  featuredId,
  loading,
  error,
  onRetry,
  onContact,
}: {
  conferences: Conference[]
  windows: Windows
  featuredId: string | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onContact: () => void
}) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<TabId>('all')
  const today = todayDateString()

  const matchesTab = (c: Conference, t: TabId) => {
    if (t === 'upcoming') return c.end_date >= today
    if (t === 'past') return c.end_date < today
    if (t === 'open') return windowState(windows.abstracts.get(c.id)) === 'open'
    return true
  }
  const term = query.trim().toLowerCase()
  const matchesQuery = (c: Conference) =>
    !term ||
    [c.name, c.code, c.short_name, c.city, countryName(c.country), c.venue_name, c.theme, c.tagline]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term))

  const filtered = conferences.filter((c) => matchesTab(c, tab) && matchesQuery(c))
  // Spotlight the featured conference only on the unfiltered view, and only when there's more than one card.
  const spotlight = tab === 'all' && !term && filtered.length > 1 ? featuredId : null
  const ordered = spotlight ? [...filtered.filter((c) => c.id === spotlight), ...filtered.filter((c) => c.id !== spotlight)] : filtered

  const emptyMessage = term && conferences.length > 0 ? SITE.conferences.emptyStates.search : SITE.conferences.emptyStates[tab]

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:py-28">
      <Reveal>
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">Discover</p>
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em] text-brand sm:text-5xl">Find your next conference</h2>
            <p className="mt-4 text-lg leading-relaxed text-text-muted">
              Browse every conference hosted here, see what's open for abstracts, and follow each one from call for papers to closing session.
            </p>
          </div>
          <div className="relative w-full lg:w-[22rem]">
            <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, code, city or theme"
              aria-label="Search conferences"
              type="search"
              className="w-full rounded-full border border-border bg-surface py-3.5 pl-11 pr-11 text-sm shadow-sm transition placeholder:text-text-muted/80 focus:border-indigo focus:outline-none focus:ring-4 focus:ring-indigo/15 [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-text-muted hover:bg-surface-muted hover:text-text"
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="-mx-4 mt-10 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <div className="inline-flex gap-1.5" role="group" aria-label="Filter conferences">
            {SITE.conferences.tabs.map((t) => {
              const active = tab === t.id
              const count = loading ? null : conferences.filter((c) => matchesTab(c, t.id as TabId)).length
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id as TabId)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition duration-200 ${
                    active ? 'border-brand bg-brand text-on-brand shadow-sm' : 'border-border-soft bg-surface text-text-muted hover:border-border hover:text-text'
                  }`}
                >
                  {t.label}
                  {count !== null ? (
                    <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active ? 'bg-white/15 text-white' : 'bg-surface-muted text-text-muted'}`}>{count}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </Reveal>

      {error ? (
        <div className="mt-10 rounded-[22px] border border-dashed border-border bg-surface px-4 py-14 text-center">
          <p className="text-sm text-text-muted">{SITE.conferences.loadError}</p>
          <button type="button" onClick={onRetry} className="mt-4 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-on-brand hover:bg-brand-hover">
            {SITE.conferences.retry}
          </button>
        </div>
      ) : loading ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : ordered.length === 0 ? (
        <div className="relative mt-10 overflow-hidden rounded-[28px] border border-border-soft bg-surface">
          <div className="grid items-center md:grid-cols-[1fr_1.1fr]">
            <img
              src="/images/home/audience-notes-800.webp"
              alt="Conference attendees taking notes during a session"
              loading="lazy"
              width={800}
              height={533}
              className="h-56 w-full object-cover md:h-full"
            />
            <div className="p-8 sm:p-10">
              <p className="font-display text-2xl font-semibold text-brand">{emptyMessage}</p>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {term || tab !== 'all'
                  ? 'Try a different search or filter — or see everything that is listed.'
                  : 'New conferences appear here as soon as their organisers publish them.'}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {term || tab !== 'all' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setTab('all')
                    }}
                    className="rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-on-brand hover:bg-brand-hover"
                  >
                    Show all conferences
                  </button>
                ) : null}
                <button type="button" onClick={onContact} className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-text hover:bg-surface-muted/60">
                  Organise a conference
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((c, i) => (
            <Reveal key={c.id} delay={Math.min(i, 5) * 70} className={`h-full ${c.id === spotlight ? 'sm:col-span-2' : ''}`}>
              <ConferenceCard conference={c} windows={windows} featured={c.id === spotlight} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  )
})
