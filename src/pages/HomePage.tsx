import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { publicImageUrl } from '../lib/storage'
import { DEFAULT_CONFERENCE_COLOR } from '../lib/color'
import { formatDateRange, formatKathmandu } from '../lib/datetime'
import { ConferenceOpeningScene } from '../components/ConferenceOpeningScene'
import { LandingHeader } from '../components/landing/LandingHeader'
import { LandingFooter } from '../components/landing/LandingFooter'
import { FaqAccordion } from '../components/landing/FaqAccordion'
import { Reveal } from '../components/landing/Reveal'
import { BackToTopButton } from '../components/landing/BackToTopButton'
import { SITE } from '../content/site'

type Conference = {
  id: string
  slug: string
  code: string
  name: string
  tagline: string | null
  city: string | null
  country: string | null
  start_date: string
  end_date: string
  status: string
  logo_path: string | null
  primary_color: string | null
}

type Announcement = {
  id: string
  title: string
  body: string
  publish_at: string | null
  created_at: string
  conference_name: string
  conference_slug: string
}

type TabId = 'all' | 'open' | 'upcoming' | 'past'
type SectionId = 'conferences' | 'how-it-works' | 'features' | 'faq' | 'contact'

const SECTION_IDS: SectionId[] = ['conferences', 'how-it-works', 'features', 'faq', 'contact']

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submission_open: 'Abstracts open',
  registration_open: 'Registration open',
  published: 'Programme published',
  ongoing: 'Programme published',
  completed: 'Past conference',
  closed: 'Past conference',
  under_review: 'Under review',
  scheduling: 'Scheduling',
}

function todayDateString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function setMetaDescription(content: string) {
  let tag = document.querySelector('meta[name="description"]')
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('name', 'description')
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-landing-border bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 rounded-md bg-landing-navy-100" />
        <div className="min-w-0 flex-1">
          <div className="h-4 w-3/4 rounded bg-landing-navy-100" />
          <div className="mt-2 h-3 w-1/2 rounded bg-landing-navy-100" />
        </div>
      </div>
      <div className="mt-4 h-3 w-2/3 rounded bg-landing-navy-100" />
      <div className="mt-3 h-5 w-24 rounded-full bg-landing-navy-100" />
    </div>
  )
}

function StepIcon({ index }: { index: number }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-landing-navy-600 text-sm font-semibold text-white">
      {index + 1}
    </div>
  )
}

const WHY_ICONS = [
  // double-blind (eye with slash)
  <path key="a" d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M6.5 6.7C4.3 8.2 2.7 10 2 12c1.6 3.6 5.5 7 10 7 1.7 0 3.3-.4 4.7-1.1M9.9 5.2A10.4 10.4 0 0 1 12 5c4.5 0 8.4 3.4 10 7-.5 1.2-1.3 2.4-2.3 3.5" />,
  // shield
  <path key="b" d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />,
  // mail
  <path key="c" d="M4 6h16v12H4V6zm0 0l8 7 8-7" />,
  // layers (one account, many conferences)
  <path key="d" d="M12 3l9 5-9 5-9-5 9-5zM3 14l9 5 9-5M3 10l9 5 9-5" />,
]

export function HomePage() {
  const [conferences, setConferences] = useState<Conference[]>([])
  const [openDeadlines, setOpenDeadlines] = useState<Set<string>>(new Set())
  const [trackCount, setTrackCount] = useState<number | null>(null)
  const [openCount, setOpenCount] = useState<number | null>(null)
  const [confCount, setConfCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<TabId>('all')
  const [activeSection, setActiveSection] = useState<SectionId>('conferences')

  const headerRef = useRef<HTMLElement | null>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const ignoreSpyRef = useRef(false)
  const ignoreSpyTimeoutRef = useRef<number | undefined>(undefined)
  const initialHashHandledRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    document.title = SITE.seo.title
    setMetaDescription(SITE.seo.description)
  }, [])

  const loadConferences = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ conferences: Conference[] }>('/conferences/public')
      if (!mountedRef.current) return
      const rows = Array.isArray(data?.conferences) ? data.conferences : []
      setConferences(rows)
      setConfCount(rows.length)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof ApiError ? err.message : 'Could not load conferences.')
    } finally {
      if (mountedRef.current) setLoading(false)
    }

    try {
      const deadlineData = await api.get<{ deadlines: Array<{ conference_id: string; opens_at: string; closes_at: string | null }> }>(
        '/conferences/public-deadlines',
        { deadline_type: 'abstract_submission' },
      )
      if (!mountedRef.current) return
      const now = Date.now()
      const open = new Set<string>()
      for (const d of deadlineData?.deadlines ?? []) {
        const opens = new Date(d.opens_at).getTime()
        const closes = d.closes_at ? new Date(d.closes_at).getTime() : null
        if (now >= opens && (closes === null || now <= closes)) open.add(d.conference_id)
      }
      setOpenDeadlines(open)
      setOpenCount(open.size)
    } catch {
      // Quiet feature: no deadline badges if this fails.
    }

    try {
      const trackData = await api.get<{ count: number }>('/conferences/public-track-count')
      if (!mountedRef.current) return
      setTrackCount(trackData.count)
    } catch {
      // Quiet feature: no track count if this fails.
    }
  }, [])

  useEffect(() => {
    loadConferences()
  }, [loadConferences])

  // Latest announcements — a quiet feature: hide the section entirely if
  // there are none to show, or if the query fails, rather than showing an error.
  useEffect(() => {
    let cancelled = false
    async function loadAnnouncements() {
      try {
        const data = await api.get<{ announcements: Announcement[] }>('/announcements/public', { limit: '3' })
        if (cancelled) return
        setAnnouncements(Array.isArray(data?.announcements) ? data.announcements : [])
      } catch {
        // Quiet feature: hide the section entirely if this fails.
      }
    }
    loadAnnouncements()
    return () => {
      cancelled = true
    }
  }, [])

  // --- Header height + scroll-spy (same approach as the conference page) --
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => setHeaderHeight(el.getBoundingClientRect().height)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function computeActiveSection(): SectionId {
    const threshold = headerHeight + 8
    const elements = SECTION_IDS.map((id) => sectionRefs.current[id]).filter((el): el is HTMLElement => Boolean(el))
    let current: SectionId = SECTION_IDS[0]
    for (const el of elements) {
      if (el.getBoundingClientRect().top <= threshold) current = el.id as SectionId
    }
    const scrolledToBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
    if (scrolledToBottom) current = SECTION_IDS[SECTION_IDS.length - 1]
    return current
  }

  useEffect(() => {
    let ticking = false
    function recompute() {
      if (ignoreSpyRef.current) return
      setActiveSection(computeActiveSection())
    }
    function onScrollOrResize() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        recompute()
        ticking = false
      })
    }
    window.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize)
    recompute()
    return () => {
      window.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerHeight, conferences])

  useEffect(() => {
    if (initialHashHandledRef.current || headerHeight === 0) return
    initialHashHandledRef.current = true
    const hash = window.location.hash.replace('#', '')
    if (!hash || !SECTION_IDS.includes(hash as SectionId)) return
    const el = sectionRefs.current[hash]
    if (!el) return
    el.scrollIntoView({ behavior: 'auto', block: 'start' })
    setActiveSection(hash as SectionId)
  }, [headerHeight])

  function handleNavigate(id: string) {
    const el = sectionRefs.current[id]
    if (!el) return
    setActiveSection(id as SectionId)
    ignoreSpyRef.current = true
    if (ignoreSpyTimeoutRef.current) window.clearTimeout(ignoreSpyTimeoutRef.current)

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
    window.history.replaceState(null, '', `#${id}`)

    function stopIgnoring() {
      ignoreSpyRef.current = false
      window.removeEventListener('scrollend', stopIgnoring)
      if (ignoreSpyTimeoutRef.current) window.clearTimeout(ignoreSpyTimeoutRef.current)
    }
    window.addEventListener('scrollend', stopIgnoring, { once: true })
    ignoreSpyTimeoutRef.current = window.setTimeout(stopIgnoring, 700)
  }

  const today = todayDateString()

  const filtered = conferences.filter((c) => {
    if (tab === 'upcoming' && c.end_date < today) return false
    if (tab === 'past' && c.end_date >= today) return false
    if (tab === 'open' && !openDeadlines.has(c.id)) return false
    const term = query.trim().toLowerCase()
    if (!term) return true
    return (
      (c.name ?? '').toLowerCase().includes(term) ||
      (c.code ?? '').toLowerCase().includes(term) ||
      (c.city ?? '').toLowerCase().includes(term)
    )
  })

  const emptyMessage =
    query.trim() && filtered.length === 0 && conferences.length > 0
      ? SITE.conferences.emptyStates.search
      : SITE.conferences.emptyStates[tab]

  return (
    <div className="min-h-screen bg-landing-bg text-landing-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-landing-navy-900 focus:shadow-lg"
      >
        Skip to main content
      </a>

      <LandingHeader ref={headerRef} activeSection={activeSection} onNavigate={handleNavigate} />

      <main id="main-content">
      {/* ---------------------------------------------------------------- Hero */}
      <section className="bg-landing-navy-900 text-white">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-10 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:py-24">
          <div className="w-full text-center lg:w-1/2 lg:text-left">
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">{SITE.hero.headline}</h1>
            <p className="mt-4 text-lg text-white/80">{SITE.hero.subheadline}</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <button
                type="button"
                onClick={() => handleNavigate('conferences')}
                className="rounded-md bg-white px-5 py-2.5 font-medium text-landing-navy-900 hover:opacity-90"
              >
                {SITE.hero.primaryCta}
              </button>
              <Link
                to="/signup"
                className="rounded-md border border-white/40 px-5 py-2.5 font-medium text-white hover:bg-white/10"
              >
                {SITE.hero.secondaryCta}
              </Link>
            </div>

            <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-6 text-center lg:text-left">
              <HeroStat label="Conferences" value={confCount} />
              <HeroStat label="Open for abstracts" value={openCount} />
              <HeroStat label="Tracks" value={trackCount} />
            </dl>
          </div>

          <div className="w-full lg:w-1/2">
            <div className="mx-auto max-w-[480px] overflow-hidden rounded-xl shadow-2xl lg:mx-0 lg:ml-auto">
              <ConferenceOpeningScene
                title="Conference portal"
                subtitle="Find a conference, submit your research, join the programme"
                laptopLabel="CMS"
                color="#1F3F73"
              />
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- Conferences */}
      <section
        id="conferences"
        ref={(el) => {
          sectionRefs.current.conferences = el
        }}
        style={{ scrollMarginTop: headerHeight + 8 }}
        className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6"
      >
        <Reveal>
        <h2 className="text-2xl font-semibold sm:text-3xl">{SITE.conferences.heading}</h2>
        <p className="mt-2 text-landing-muted">{SITE.conferences.description}</p>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {SITE.conferences.tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id as TabId)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  tab === t.id
                    ? 'border-landing-navy-600 bg-landing-navy-600 text-white'
                    : 'border-landing-border text-landing-muted hover:bg-landing-navy-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={SITE.conferences.searchPlaceholder}
            className="w-full rounded-md border border-landing-border px-3 py-2 text-sm focus:border-landing-navy-600 sm:w-72"
          />
        </div>

        {error ? (
          <div className="mt-8 rounded-xl border border-dashed border-landing-border bg-white px-4 py-10 text-center">
            <p className="text-sm text-landing-muted">{SITE.conferences.loadError}</p>
            <button
              type="button"
              onClick={() => loadConferences()}
              className="mt-4 rounded-md bg-landing-navy-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {SITE.conferences.retry}
            </button>
          </div>
        ) : loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-landing-border bg-white px-4 py-10 text-center text-sm text-landing-muted">
            {emptyMessage}
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => {
              const accent = c.primary_color ?? DEFAULT_CONFERENCE_COLOR
              const logoUrl = publicImageUrl(c.logo_path)
              return (
                <Link
                  key={c.id}
                  to={`/c/${c.slug}`}
                  style={{ borderTopColor: accent }}
                  className="rounded-xl border border-landing-border border-t-4 bg-white p-5 shadow-sm transition hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    {logoUrl ? (
                      <img src={logoUrl} alt="" loading="lazy" className="h-12 w-12 shrink-0 object-contain" />
                    ) : null}
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-landing-text">{c.name}</h3>
                      {c.tagline ? <p className="truncate text-sm text-landing-muted">{c.tagline}</p> : null}
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-landing-muted">
                    {formatDateRange(c.start_date, c.end_date)}
                    {c.city ? ` · ${c.city}` : ''}
                  </p>
                  <span
                    style={{ backgroundColor: `${accent}1a`, color: accent }}
                    className="mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-medium"
                  >
                    {STATUS_LABELS[c.status] ?? c.status}
                  </span>
                  <p className="mt-4 text-sm font-medium" style={{ color: accent }}>
                    View conference →
                  </p>
                </Link>
              )
            })}
          </div>
        )}
        </Reveal>
      </section>

      {/* ------------------------------------------------------ Announcements */}
      {announcements.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-4 pb-16 sm:px-6">
          <Reveal>
          <h2 className="text-2xl font-semibold sm:text-3xl">{SITE.announcements.heading}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {announcements.map((a) => {
              const bodyLines = a.body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' ')
              return (
                <div key={a.id} className="rounded-xl border border-landing-border bg-white p-5">
                  {a.conference_name ? (
                    <p className="text-xs font-semibold uppercase tracking-wide text-landing-navy-600">
                      {a.conference_name}
                    </p>
                  ) : null}
                  <h3 className="mt-1 font-semibold text-landing-text">{a.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm text-landing-muted">{bodyLines}</p>
                  <p className="mt-3 text-xs text-landing-muted">
                    {formatKathmandu(a.publish_at ?? a.created_at, { dateOnly: true })}
                  </p>
                </div>
              )
            })}
          </div>
          </Reveal>
        </section>
      ) : null}

      {/* ------------------------------------------------------- How it works */}
      <section
        id="how-it-works"
        ref={(el) => {
          sectionRefs.current['how-it-works'] = el
        }}
        style={{ scrollMarginTop: headerHeight + 8 }}
        className="bg-landing-navy-100"
      >
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <Reveal>
          <h2 className="text-center text-2xl font-semibold sm:text-3xl">{SITE.steps.heading}</h2>
          <div className="relative mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="absolute top-5 left-0 right-0 hidden h-px bg-landing-border lg:block" aria-hidden="true" />
            {SITE.steps.items.map((step, i) => (
              <div key={step.title} className="relative flex flex-col items-center text-center lg:items-start lg:text-left">
                <StepIcon index={i} />
                <p className="mt-4 font-semibold">{step.title}</p>
                <p className="mt-1 text-sm text-landing-muted">{step.description}</p>
              </div>
            ))}
          </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------------------------------------- Features */}
      <section
        id="features"
        ref={(el) => {
          sectionRefs.current.features = el
        }}
        style={{ scrollMarginTop: headerHeight + 8 }}
        className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6"
      >
        <Reveal>
        <h2 className="text-center text-2xl font-semibold sm:text-3xl">{SITE.roles.heading}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SITE.roles.items.map((role) => (
            <div key={role.title} className="rounded-xl border border-landing-border bg-white p-5">
              <h3 className="font-semibold">{role.title}</h3>
              <ul className="mt-3 space-y-2 text-sm text-landing-muted">
                {role.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-landing-gold" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-landing-muted">{SITE.roles.note}</p>

        <h2 className="mt-20 text-center text-2xl font-semibold sm:text-3xl">{SITE.whyPlatform.heading}</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SITE.whyPlatform.items.map((item, i) => (
            <div key={item.title} className="text-center lg:text-left">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mx-auto text-landing-navy-600 lg:mx-0"
              >
                {WHY_ICONS[i]}
              </svg>
              <p className="mt-3 font-semibold">{item.title}</p>
              <p className="mt-1 text-sm text-landing-muted">{item.description}</p>
            </div>
          ))}
        </div>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- FAQ */}
      <section
        id="faq"
        ref={(el) => {
          sectionRefs.current.faq = el
        }}
        style={{ scrollMarginTop: headerHeight + 8 }}
        className="bg-landing-navy-100"
      >
        <div className="mx-auto max-w-[760px] px-4 py-16 sm:px-6">
          <Reveal>
          <h2 className="text-center text-2xl font-semibold sm:text-3xl">{SITE.faq.heading}</h2>
          <div className="mt-8">
            <FaqAccordion items={SITE.faq.items} />
          </div>
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------------- Contact CTA */}
      <section
        id="contact"
        ref={(el) => {
          sectionRefs.current.contact = el
        }}
        style={{ scrollMarginTop: headerHeight + 8 }}
        className="bg-landing-navy-800 text-white"
      >
        <Reveal className="mx-auto flex max-w-[1200px] flex-col items-center gap-4 px-4 py-14 text-center sm:px-6">
          <h2 className="text-2xl font-semibold sm:text-3xl">{SITE.contactBand.heading}</h2>
          <p className="max-w-xl text-white/80">{SITE.contactBand.description}</p>
          <a
            href={SITE.contactGmailHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 rounded-md bg-white px-5 py-2.5 font-medium text-landing-navy-900 hover:opacity-90"
          >
            {SITE.contactBand.cta}
          </a>
        </Reveal>
      </section>
      </main>

      <LandingFooter />
      <BackToTopButton />
    </div>
  )
}

function HeroStat({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null
  return (
    <div>
      <dt className="text-sm text-white/60">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  )
}
