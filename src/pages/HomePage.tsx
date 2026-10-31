import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Award,
  BellRing,
  CalendarDays,
  Check,
  EyeOff,
  FileText,
  Gavel,
  Layers,
  LayoutGrid,
  Mail,
  MapPin,
  Megaphone,
  PenLine,
  PlayCircle,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { publicImageUrl } from '../lib/storage'
import { DEFAULT_CONFERENCE_COLOR, darken } from '../lib/color'
import { formatDateRange, formatKathmandu } from '../lib/datetime'
import { LandingHeader } from '../components/landing/LandingHeader'
import { LandingFooter } from '../components/landing/LandingFooter'
import { FaqAccordion } from '../components/landing/FaqAccordion'
import { Reveal } from '../components/landing/Reveal'
import { BackToTopButton } from '../components/landing/BackToTopButton'
import { SuggestionBox } from '../components/landing/SuggestionBox'
import { SITE } from '../content/site'
import { usePlatformSettings } from '../lib/platformSettings'

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

const STEP_ICONS: LucideIcon[] = [UserPlus, PenLine, EyeOff, Award]
const ROLE_ICONS: LucideIcon[] = [FileText, Gavel, LayoutGrid, Users]
const WHY_ICONS: LucideIcon[] = [EyeOff, ShieldCheck, Mail, Layers]

const CAPABILITIES: Array<{ icon: LucideIcon; title: string; description: string }> = [
  { icon: Megaphone, title: 'Calls for papers', description: 'Tracks, key dates and an abstract form that opens and closes on schedule.' },
  { icon: EyeOff, title: 'Double-blind review', description: 'Bidding, auto-assignment, scoring and reminders, without revealing authors.' },
  { icon: CalendarDays, title: 'Programme builder', description: 'Rooms, time slots, sessions and chairs, published with PDF and calendar export.' },
  { icon: QrCode, title: 'Registration & check-in', description: 'Free registration with QR tickets, scanned at the desk from any phone.' },
  { icon: Award, title: 'Certificates', description: 'Generated in bulk, released on your date, verifiable by a public link.' },
  { icon: BellRing, title: 'Email at every step', description: 'Approvals, decisions and announcements, sent and logged automatically.' },
]

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null

function countryName(code: string | null): string | null {
  if (!code) return null
  try {
    return regionNames?.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

function placeLabel(c: Pick<Conference, 'city' | 'country'>): string | null {
  return [c.city, countryName(c.country)].filter(Boolean).join(', ') || null
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  return (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase()
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
    <div className="animate-pulse overflow-hidden rounded-2xl border border-border-soft bg-surface">
      <div className="h-20 bg-surface-muted" />
      <div className="px-5 pb-5">
        <div className="relative -mt-8 h-16 w-16 rounded-xl border-4 border-surface bg-surface-muted" />
        <div className="mt-4 h-4 w-3/4 rounded bg-surface-muted" />
        <div className="mt-2 h-3 w-1/2 rounded bg-surface-muted" />
        <div className="mt-5 h-3 w-2/3 rounded bg-surface-muted" />
        <div className="mt-2 h-3 w-1/3 rounded bg-surface-muted" />
      </div>
    </div>
  )
}

/** Conference logo, falling back to the conference's initials on its own colour if there's no logo or it fails to load. */
function ConferenceLogo({ conference, accent, className }: { conference: Conference; accent: string; className: string }) {
  const logoUrl = publicImageUrl(conference.logo_path)
  const [failed, setFailed] = useState(false)
  if (logoUrl && !failed) {
    return (
      <span className={`flex items-center justify-center overflow-hidden bg-white ${className}`}>
        <img src={logoUrl} alt="" loading="lazy" className="h-full w-full object-contain p-1.5" onError={() => setFailed(true)} />
      </span>
    )
  }
  return (
    <span
      className={`flex items-center justify-center font-display text-lg font-semibold text-white ${className}`}
      style={{ backgroundColor: accent }}
      aria-hidden="true"
    >
      {initials(conference.name)}
    </span>
  )
}

function ConferenceCard({ conference: c, abstractsOpen }: { conference: Conference; abstractsOpen: boolean }) {
  const accent = c.primary_color ?? DEFAULT_CONFERENCE_COLOR
  const place = placeLabel(c)
  return (
    <Link
      to={`/c/${c.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-card-hover"
    >
      <div
        className="relative h-20 shrink-0"
        style={{ backgroundImage: `linear-gradient(135deg, ${accent} 0%, ${darken(accent, 0.4)} 100%)` }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:14px_14px]" />
        {c.code ? (
          <span className="absolute right-3 top-3 rounded-md bg-black/20 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-white/90 backdrop-blur-sm">
            {c.code}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col px-5 pb-5">
        <ConferenceLogo conference={c} accent={accent} className="relative z-10 -mt-8 h-16 w-16 rounded-xl border-4 border-surface shadow-sm" />
        <h3 className="mt-3 line-clamp-2 text-base font-semibold leading-snug text-text">{c.name}</h3>
        {c.tagline ? <p className="mt-1 line-clamp-1 text-sm text-text-muted">{c.tagline}</p> : null}

        <dl className="mt-4 space-y-1.5 text-sm text-text-muted">
          <div className="flex items-center gap-2">
            <dt className="sr-only">Dates</dt>
            <CalendarDays size={15} aria-hidden="true" className="shrink-0" />
            <dd>{formatDateRange(c.start_date, c.end_date)}</dd>
          </div>
          {place ? (
            <div className="flex items-center gap-2">
              <dt className="sr-only">Location</dt>
              <MapPin size={15} aria-hidden="true" className="shrink-0" />
              <dd className="truncate capitalize">{place}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span
              style={{ backgroundColor: `${accent}1a`, color: darken(accent, 0.2) }}
              className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium"
            >
              {STATUS_LABELS[c.status] ?? c.status}
            </span>
            {abstractsOpen && c.status !== 'submission_open' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                Accepting abstracts
              </span>
            ) : null}
          </div>
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-soft text-text-muted transition group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand"
            aria-hidden="true"
          >
            <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
      <span className="sr-only">View conference</span>
    </Link>
  )
}

/** Hero illustration: the next upcoming conference as a live card, plus a small "paper journey" panel. */
function HeroShowcase({ conference, abstractsOpen, loading }: { conference: Conference | null; abstractsOpen: boolean; loading: boolean }) {
  const accent = conference?.primary_color ?? DEFAULT_CONFERENCE_COLOR
  const journey = [
    { label: 'Abstract submitted', done: true },
    { label: 'Double-blind review', done: true },
    { label: 'Accepted for the programme', done: true },
    { label: 'Certificate issued', done: false },
  ]
  return (
    <div className="relative mx-auto w-full max-w-[460px] lg:ml-auto lg:mr-0">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-brand/15 via-transparent to-button/10 blur-2xl" aria-hidden="true" />

      {/* Featured conference */}
      {loading ? (
        <div className="h-[244px] animate-pulse rounded-2xl border border-border-soft bg-surface shadow-card-hover" />
      ) : conference ? (
        <Link
          to={`/c/${conference.slug}`}
          className="block overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-card-hover transition hover:-translate-y-0.5"
        >
          <div
            className="flex items-center justify-between px-5 py-3 text-xs font-medium uppercase tracking-[0.14em] text-white"
            style={{ backgroundImage: `linear-gradient(135deg, ${accent} 0%, ${darken(accent, 0.4)} 100%)` }}
          >
            <span className="flex items-center gap-1.5">
              <Sparkles size={14} aria-hidden="true" /> Next up
            </span>
            {conference.code ? <span className="font-mono normal-case tracking-normal text-white/80">{conference.code}</span> : null}
          </div>
          <div className="p-5">
            <div className="flex items-start gap-4">
              <ConferenceLogo conference={conference} accent={accent} className="h-14 w-14 shrink-0 rounded-xl border border-border-soft" />
              <div className="min-w-0">
                <p className="line-clamp-2 font-semibold leading-snug text-text">{conference.name}</p>
                {conference.tagline ? <p className="mt-0.5 line-clamp-1 text-sm text-text-muted">{conference.tagline}</p> : null}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-page-bg px-3 py-2.5">
                <p className="text-xs text-text-muted">When</p>
                <p className="mt-0.5 font-medium text-text">{formatDateRange(conference.start_date, conference.end_date)}</p>
              </div>
              <div className="rounded-xl bg-page-bg px-3 py-2.5">
                <p className="text-xs text-text-muted">Where</p>
                <p className="mt-0.5 truncate font-medium capitalize text-text">{placeLabel(conference) ?? 'To be announced'}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              {abstractsOpen ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-success">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                  </span>
                  Accepting abstracts
                </span>
              ) : (
                <span className="text-text-muted">{STATUS_LABELS[conference.status] ?? conference.status}</span>
              )}
              <span className="inline-flex items-center gap-1 font-medium text-brand">
                View <ArrowRight size={15} aria-hidden="true" />
              </span>
            </div>
          </div>
        </Link>
      ) : null}

      {/* Paper journey */}
      <div className="relative z-10 -mt-4 ml-6 rounded-2xl border border-border-soft bg-surface/95 p-4 shadow-card-hover backdrop-blur sm:ml-16" aria-hidden="true">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">A paper's journey</p>
        <ol className="mt-3 space-y-2.5">
          {journey.map((step, i) => (
            <li key={step.label} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  step.done ? 'bg-brand text-on-brand' : 'border-2 border-dashed border-border text-text-muted'
                }`}
              >
                {step.done ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              <span className={step.done ? 'text-text' : 'text-text-muted'}>{step.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function SectionHeading({ eyebrow, title, description, center = false }: { eyebrow: string; title: string; description?: string; center?: boolean }) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">{eyebrow}</p>
      <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">{title}</h2>
      {description ? <p className="mt-3 text-base leading-relaxed text-text-muted sm:text-lg">{description}</p> : null}
    </div>
  )
}

export function HomePage() {
  const platformSettings = usePlatformSettings()
  const heroHeadline = platformSettings?.hero_headline ?? SITE.hero.headline
  const heroSubheadline = platformSettings?.hero_subheadline ?? SITE.hero.subheadline
  const faqItems = platformSettings?.faq_items ?? SITE.faq.items
  const contactEmail = platformSettings?.support_email ?? SITE.contactEmail
  const contactGmailHref = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(contactEmail)}`

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
  const demoSectionRef = useRef<HTMLElement | null>(null)
  const demoVideoRef = useRef<HTMLVideoElement | null>(null)
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
    if (!hash) return
    if (SECTION_IDS.includes(hash as SectionId)) {
      const el = sectionRefs.current[hash]
      if (!el) return
      el.scrollIntoView({ behavior: 'auto', block: 'start' })
      setActiveSection(hash as SectionId)
      return
    }
    // Not a nav-tracked section (e.g. #suggestions, reached from the footer's
    // Feedback link on any page) — just scroll to it if it exists.
    document.getElementById(hash)?.scrollIntoView({ behavior: 'auto', block: 'start' })
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

  function handleWatchDemo() {
    const section = demoSectionRef.current
    if (!section) return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    section.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
    const video = demoVideoRef.current
    if (video) {
      video.focus({ preventScroll: true })
      video.play().catch(() => {
        // Autoplay can still be blocked by the browser even after a click in
        // some configurations - the visible controls are the fallback, not an error.
      })
    }
  }

  const today = todayDateString()

  // Hero card: the soonest conference that hasn't ended, preferring one open for abstracts.
  const upcoming = conferences
    .filter((c) => c.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  const featured = upcoming.find((c) => openDeadlines.has(c.id)) ?? upcoming[0] ?? conferences[0] ?? null

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

  const scrollMargin = { scrollMarginTop: headerHeight + 8 }

  return (
    <div className="min-h-screen overflow-x-clip bg-page-bg text-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-brand focus:shadow-lg"
      >
        Skip to main content
      </a>

      <LandingHeader ref={headerRef} activeSection={activeSection} onNavigate={handleNavigate} />

      <main id="main-content">
        {/* ---------------------------------------------------------------- Hero */}
        <section className="relative isolate">
          <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
            <div className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
            <div className="absolute -right-32 top-24 h-[360px] w-[360px] rounded-full bg-button/10 blur-3xl" />
            <div className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,rgb(183_168_154/0.25)_1px,transparent_1px),linear-gradient(to_bottom,rgb(183_168_154/0.25)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
          </div>

          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.15fr_1fr] lg:gap-12 lg:pb-24 lg:pt-20">
            <div className="text-center lg:text-left">
              <p className="inline-flex items-center gap-2 rounded-full border border-border-soft bg-surface/80 px-3 py-1 text-xs font-medium text-text-muted shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
                Calls for papers · Review · Programme · Certificates
              </p>
              <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.1] tracking-tight text-text sm:text-5xl lg:text-[3.5rem]">
                {heroHeadline}
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-text-muted lg:mx-0">{heroSubheadline}</p>

              <div className="mt-8 flex flex-col items-stretch justify-center gap-3 whitespace-nowrap sm:flex-row sm:flex-wrap sm:items-center lg:justify-start">
                <button
                  type="button"
                  onClick={() => handleNavigate('conferences')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 font-medium text-on-brand shadow-sm transition hover:bg-brand-hover"
                >
                  {SITE.hero.primaryCta}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
                <Link
                  to="/signup"
                  className="inline-flex items-center justify-center rounded-xl border border-border bg-surface px-5 py-3 font-medium text-text shadow-sm transition hover:bg-surface-muted/50"
                >
                  {SITE.hero.secondaryCta}
                </Link>
                <button
                  type="button"
                  onClick={handleWatchDemo}
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-3 font-medium text-text transition hover:text-brand"
                >
                  <PlayCircle size={20} aria-hidden="true" className="text-brand" />
                  Watch the demo
                </button>
              </div>

              <dl className="mx-auto mt-10 grid max-w-md grid-cols-3 divide-x divide-border-soft rounded-2xl border border-border-soft bg-surface/70 py-4 shadow-sm backdrop-blur lg:mx-0">
                <HeroStat label="Conferences" value={confCount} />
                <HeroStat label="Open for abstracts" value={openCount} />
                <HeroStat label="Tracks" value={trackCount} />
              </dl>
            </div>

            <HeroShowcase conference={featured} abstractsOpen={featured ? openDeadlines.has(featured.id) : false} loading={loading && !error} />
          </div>
        </section>

        {/* --------------------------------------------------------- Conferences */}
        <section
          id="conferences"
          ref={(el) => {
            sectionRefs.current.conferences = el
          }}
          style={scrollMargin}
          className="border-t border-border-soft bg-surface/50"
        >
          <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
            <Reveal>
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <SectionHeading eyebrow="Explore" title={SITE.conferences.heading} description={SITE.conferences.description} />
                <div className="relative w-full lg:w-80">
                  <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={SITE.conferences.searchPlaceholder}
                    aria-label={SITE.conferences.searchPlaceholder}
                    type="search"
                    className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm shadow-sm placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                </div>
              </div>

              <div className="mt-8 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <div className="inline-flex gap-1 rounded-xl border border-border-soft bg-surface p-1 shadow-sm" role="group" aria-label="Filter conferences">
                  {SITE.conferences.tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id as TabId)}
                      aria-pressed={tab === t.id}
                      className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                        tab === t.id ? 'bg-brand text-on-brand shadow-sm' : 'text-text-muted hover:bg-surface-muted/50 hover:text-text'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {error ? (
                <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface px-4 py-12 text-center">
                  <p className="text-sm text-text-muted">{SITE.conferences.loadError}</p>
                  <button
                    type="button"
                    onClick={() => loadConferences()}
                    className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover"
                  >
                    {SITE.conferences.retry}
                  </button>
                </div>
              ) : loading ? (
                <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <SkeletonCard key={i} />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface px-4 py-14 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted/60 text-text-muted">
                    <Search size={20} aria-hidden="true" />
                  </span>
                  <p className="mt-4 text-sm text-text-muted">{emptyMessage}</p>
                  {query.trim() || tab !== 'all' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('')
                        setTab('all')
                      }}
                      className="mt-4 text-sm font-medium text-brand underline-offset-4 hover:underline"
                    >
                      Show all conferences
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((c) => (
                    <ConferenceCard key={c.id} conference={c} abstractsOpen={openDeadlines.has(c.id)} />
                  ))}
                </div>
              )}
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------ Announcements */}
        {announcements.length > 0 ? (
          <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
            <Reveal>
              <SectionHeading eyebrow="News" title={SITE.announcements.heading} />
              <div className={`mt-8 grid gap-5 ${announcements.length >= 3 ? 'md:grid-cols-3' : announcements.length === 2 ? 'md:grid-cols-2' : 'max-w-xl'}`}>
                {announcements.map((a) => {
                  const bodyLines = a.body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' ')
                  const inner = (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        {a.conference_name ? (
                          <p className="truncate text-xs font-semibold uppercase tracking-wide text-brand">{a.conference_name}</p>
                        ) : (
                          <span />
                        )}
                        <p className="shrink-0 text-xs text-text-muted">{formatKathmandu(a.publish_at ?? a.created_at, { dateOnly: true })}</p>
                      </div>
                      <h3 className="mt-3 font-semibold leading-snug text-text">{a.title}</h3>
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-text-muted">{bodyLines}</p>
                    </>
                  )
                  return a.conference_slug ? (
                    <Link
                      key={a.id}
                      to={`/c/${a.conference_slug}`}
                      className="rounded-2xl border border-border-soft bg-surface p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={a.id} className="rounded-2xl border border-border-soft bg-surface p-6 shadow-card">
                      {inner}
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
          style={scrollMargin}
          className="border-y border-border-soft bg-surface-muted/40"
        >
          <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
            <Reveal>
              <SectionHeading eyebrow="For authors" title={SITE.steps.heading} description="From your first abstract to the certificate in your inbox, in four steps." center />
              <ol className="relative mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="absolute left-[12.5%] right-[12.5%] top-7 hidden h-px border-t-2 border-dashed border-border lg:block" aria-hidden="true" />
                {SITE.steps.items.map((step, i) => {
                  const Icon = STEP_ICONS[i] ?? Check
                  return (
                    <li key={step.title} className="relative flex flex-col items-center rounded-2xl p-2 text-center">
                      <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-brand shadow-card ring-1 ring-border-soft">
                        <Icon size={24} aria-hidden="true" />
                        <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-semibold text-on-brand">
                          {i + 1}
                        </span>
                      </span>
                      <p className="mt-5 font-semibold text-text">{step.title}</p>
                      <p className="mt-2 max-w-[16rem] text-sm leading-relaxed text-text-muted">{step.description}</p>
                    </li>
                  )
                })}
              </ol>
              <div className="mt-12 flex justify-center">
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 font-medium text-on-brand shadow-sm transition hover:bg-brand-hover"
                >
                  Create your account
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>

        {/* -------------------------------------------------------- See it in action */}
        <section
          id="demo"
          ref={(el) => {
            demoSectionRef.current = el
          }}
          style={scrollMargin}
          className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6"
        >
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Product tour</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">See it in action</h2>
              <p className="mt-3 text-base leading-relaxed text-text-muted sm:text-lg">
                A two-minute tour, from submitting a paper to downloading a certificate.
              </p>
            </div>
            <div className="mx-auto mt-10 max-w-[1000px] rounded-[1.25rem] border border-border-soft bg-surface p-2 shadow-card-hover sm:p-3">
              <div className="aspect-video overflow-hidden rounded-xl bg-surface-muted">
                <video
                  ref={demoVideoRef}
                  controls
                  playsInline
                  preload="none"
                  poster="/video/poster.jpg"
                  className="h-full w-full"
                >
                  <source src="/video/product-video-web.mp4" type="video/mp4" />
                  <track kind="captions" src="/video/demo.vtt" srcLang="en" label="English" default />
                </video>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ----------------------------------------------------------- Features */}
        <section
          id="features"
          ref={(el) => {
            sectionRefs.current.features = el
          }}
          style={scrollMargin}
          className="border-t border-border-soft bg-surface/50"
        >
          <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
            <Reveal>
              <SectionHeading
                eyebrow="Features"
                title="Everything a conference needs"
                description="One platform from the call for papers to the closing session, with nothing to install."
                center
              />
              <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border-soft bg-border-soft sm:grid-cols-2 lg:grid-cols-3">
                {CAPABILITIES.map(({ icon: Icon, title, description }) => (
                  <div key={title} className="bg-surface p-6 transition-colors hover:bg-page-bg sm:p-7">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                      <Icon size={22} aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 font-semibold text-text">{title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{description}</p>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal className="mt-24">
              <SectionHeading eyebrow="Roles" title={SITE.roles.heading} description={SITE.roles.note} center />
              <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {SITE.roles.items.map((role, i) => {
                  const Icon = ROLE_ICONS[i] ?? Users
                  return (
                    <div key={role.title} className="rounded-2xl border border-border-soft bg-surface p-6 shadow-card">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-button/10 text-button">
                        <Icon size={20} aria-hidden="true" />
                      </span>
                      <h3 className="mt-4 font-semibold text-text">{role.title}</h3>
                      <ul className="mt-3 space-y-2.5 text-sm text-text-muted">
                        {role.bullets.map((b) => (
                          <li key={b} className="flex gap-2.5">
                            <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </Reveal>

            <Reveal className="mt-24">
              <h2 className="text-center font-display text-2xl font-semibold tracking-tight text-text sm:text-3xl">{SITE.whyPlatform.heading}</h2>
              <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                {SITE.whyPlatform.items.map((item, i) => {
                  const Icon = WHY_ICONS[i] ?? ShieldCheck
                  return (
                    <div key={item.title} className="flex gap-4">
                      <Icon size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
                      <div>
                        <p className="font-semibold text-text">{item.title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-text-muted">{item.description}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------------- FAQ */}
        <section
          id="faq"
          ref={(el) => {
            sectionRefs.current.faq = el
          }}
          style={scrollMargin}
          className="border-t border-border-soft"
        >
          <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
            <Reveal>
              <SectionHeading eyebrow="Help" title={SITE.faq.heading} description="Can't find what you're looking for? Send us a message and we'll get back to you." />
              <a
                href={contactGmailHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand underline-offset-4 hover:underline"
              >
                <Mail size={16} aria-hidden="true" />
                {contactEmail}
              </a>
            </Reveal>
            <Reveal delay={100}>
              <FaqAccordion items={faqItems} />
            </Reveal>
          </div>
        </section>

        {/* --------------------------------------------------------- Contact CTA */}
        <section
          id="contact"
          ref={(el) => {
            sectionRefs.current.contact = el
          }}
          style={scrollMargin}
          className="px-4 sm:px-6"
        >
          <Reveal className="relative mx-auto max-w-[1200px] overflow-hidden rounded-3xl bg-brand px-6 py-14 text-center text-on-brand shadow-card-hover sm:px-12 sm:py-16">
            <div className="absolute inset-0 -z-0 opacity-25 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:18px_18px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" aria-hidden="true" />
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
            <div className="relative">
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{SITE.contactBand.heading}</h2>
              <p className="mx-auto mt-3 max-w-xl text-base text-on-brand/80 sm:text-lg">{SITE.contactBand.description}</p>
              <a
                href={contactGmailHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-surface px-6 py-3 font-medium text-brand shadow-sm transition hover:bg-white"
              >
                {SITE.contactBand.cta}
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
          </Reveal>
        </section>

        {/* ----------------------------------------------------- Suggestion box */}
        <SuggestionBox />
      </main>

      <LandingFooter />
      <BackToTopButton />
    </div>
  )
}

function HeroStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col-reverse px-2 text-center">
      <dt className="mt-0.5 text-xs leading-tight text-text-muted sm:text-sm">{label}</dt>
      <dd className="font-display text-2xl font-semibold text-text sm:text-3xl">
        {value === null ? <span className="inline-block h-7 w-8 animate-pulse rounded bg-surface-muted align-middle" /> : value}
      </dd>
    </div>
  )
}
