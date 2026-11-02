import { useEffect, useRef, useState, memo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Award, CalendarDays, Check, EyeOff, FileText, MapPin, PlayCircle } from 'lucide-react'
import { publicImageUrl } from '../../../lib/storage'
import { DEFAULT_CONFERENCE_COLOR } from '../../../lib/color'
import { formatDateRange } from '../../../lib/datetime'
import { CountUp } from '../Reveal'
import { initials, placeLabel, shortDate, STATUS_LABELS, type Conference, type DeadlineWindow } from './homeData'

/** Conference logo, falling back to initials on the conference colour if there's no logo or it fails to load. */
export function ConferenceLogo({ conference, className }: { conference: Conference; className: string }) {
  const logoUrl = publicImageUrl(conference.logo_path)
  const [failed, setFailed] = useState(false)
  const accent = conference.primary_color ?? DEFAULT_CONFERENCE_COLOR
  if (logoUrl && !failed) {
    return (
      <span className={`flex items-center justify-center overflow-hidden bg-white ${className}`}>
        <img src={logoUrl} alt="" loading="lazy" className="h-full w-full object-contain p-1.5" onError={() => setFailed(true)} />
      </span>
    )
  }
  return (
    <span
      className={`flex items-center justify-center font-display font-semibold text-white ${className}`}
      style={{ backgroundColor: accent }}
      aria-hidden="true"
    >
      {initials(conference.name)}
    </span>
  )
}

/** Moves the hero photo a few pixels against the scroll for depth. Off under reduced motion. */
function useParallax<T extends HTMLElement>(strength = 0.12) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const update = () => {
      frame = 0
      const y = Math.min(window.scrollY, 900) * strength
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scale(1.08)`
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [strength])
  return ref
}

const JOURNEY = [
  { label: 'Abstract submitted', icon: FileText },
  { label: 'Double-blind review', icon: EyeOff },
  { label: 'Accepted to programme', icon: Check },
  { label: 'Certificate issued', icon: Award },
] as const

/** A paper's path through the platform, stepping forward on a slow loop (fully complete under reduced motion). */
function JourneyCard() {
  const [step, setStep] = useState(JOURNEY.length - 1)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setStep(0)
    const id = window.setInterval(() => setStep((s) => (s + 1) % (JOURNEY.length + 1)), 1600)
    return () => window.clearInterval(id)
  }, [])
  const shown = Math.min(step, JOURNEY.length - 1)
  return (
    <div className="w-[240px] rounded-xl border border-border-soft bg-white p-4 shadow-[0_12px_30px_-18px_rgb(16_28_50/0.45)]" aria-hidden="true">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted">What happens to a paper</p>
        <span className="font-mono text-[11px] text-text-muted">
          {shown + 1}/{JOURNEY.length}
        </span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full rounded-full bg-brand transition-all duration-700 ease-out"
          style={{ width: `${((shown + 1) / JOURNEY.length) * 100}%` }}
        />
      </div>
      <ol className="mt-3 space-y-2.5">
        {JOURNEY.map((j, i) => {
          const done = i <= step
          const Icon = j.icon
          return (
            <li key={j.label} className="flex items-center gap-3 text-[13px]">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-500 ${
                  done ? 'bg-brand text-on-brand' : 'border border-border bg-white text-text-muted'
                }`}
              >
                <Icon size={12} strokeWidth={2.5} />
              </span>
              <span className={`transition-colors duration-500 ${done ? 'font-medium text-text' : 'text-text-muted'}`}>{j.label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function HeroStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col-reverse px-4 first:pl-0 last:pr-0 sm:px-6">
      <dt className="mt-1 text-xs leading-tight text-text-muted sm:text-[13px]">{label}</dt>
      <dd className="font-display text-3xl font-semibold text-brand sm:text-4xl">
        {value === null ? <span className="inline-block h-8 w-10 animate-pulse rounded bg-surface-muted align-middle" /> : <CountUp value={value} />}
      </dd>
    </div>
  )
}

function FeaturedCard({
  conference,
  abstracts,
  abstractsOpen,
  loading,
}: {
  conference: Conference | null
  abstracts: DeadlineWindow | undefined
  abstractsOpen: boolean
  loading: boolean
}) {
  if (loading) return <div className="h-[150px] w-full animate-pulse rounded-xl bg-white/70" />
  if (!conference) {
    return (
      <div className="rounded-xl border border-border-soft bg-white p-5">
        <p className="text-xs font-medium text-text-muted">Coming soon</p>
        <p className="mt-2 font-display text-lg font-semibold leading-snug text-text">New conferences are announced here first.</p>
        <p className="mt-1 text-sm text-text-muted">Organising one? We'll set it up for you.</p>
      </div>
    )
  }
  const place = placeLabel(conference)
  return (
    <Link
      to={`/c/${conference.slug}`}
      className="group block rounded-xl border border-border-soft bg-white p-5 shadow-[0_18px_40px_-24px_rgb(16_28_50/0.5)] transition duration-300 hover:border-border"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-text-muted">Next up</p>
        {abstractsOpen ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
            {abstracts?.closes_at ? `Abstracts close ${shortDate(abstracts.closes_at)}` : 'Accepting abstracts'}
          </span>
        ) : (
          <span className="text-xs text-text-muted">{STATUS_LABELS[conference.status] ?? conference.status}</span>
        )}
      </div>
      <div className="mt-3 flex items-start gap-3.5">
        <ConferenceLogo conference={conference} className="h-12 w-12 shrink-0 rounded-xl border border-border-soft text-sm" />
        <div className="min-w-0">
          <p className="line-clamp-2 font-display text-[17px] font-semibold leading-snug text-text">{conference.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-text-muted">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={13} aria-hidden="true" /> {formatDateRange(conference.start_date, conference.end_date)}
            </span>
            {place ? (
              <span className="inline-flex items-center gap-1 capitalize">
                <MapPin size={13} aria-hidden="true" /> {place}
              </span>
            ) : null}
          </p>
        </div>
        <ArrowRight size={18} aria-hidden="true" className="ml-auto mt-1 shrink-0 text-brand transition group-hover:translate-x-1" />
      </div>
    </Link>
  )
}

export const HomeHero = memo(function HomeHero({
  headline,
  subheadline,
  featured,
  featuredAbstracts,
  featuredAbstractsOpen,
  loading,
  stats,
  onExplore,
  onDiscover,
  onWatchDemo,
}: {
  headline: string
  subheadline: string
  featured: Conference | null
  featuredAbstracts: DeadlineWindow | undefined
  featuredAbstractsOpen: boolean
  loading: boolean
  stats: { conferences: number | null; open: number | null; tracks: number | null }
  onExplore: () => void
  onDiscover: () => void
  onWatchDemo: () => void
}) {
  const photoRef = useParallax<HTMLImageElement>()

  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="home-hero-title">
      {/* One flat warm panel behind the photo - nothing animated in the background. */}
      <div className="absolute inset-y-0 right-0 -z-10 hidden w-[38%] bg-gold-soft/60 lg:block" aria-hidden="true" />

      <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1fr_1.02fr] lg:gap-16 lg:pb-20 lg:pt-10">
        {/* Editorial column */}
        <div className="relative">
          <div className="home-rise" style={{ animationDelay: '60ms' }}>
            {stats.open !== null && stats.open > 0 ? (
              <button
                type="button"
                onClick={onExplore}
                className="group inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand"
              >
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
                <span>
                  <span className="font-semibold text-brand">{stats.open}</span> {stats.open === 1 ? 'conference is' : 'conferences are'} taking
                  abstracts right now
                </span>
                <ArrowRight size={14} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
              </button>
            ) : (
              <p className="text-sm text-text-muted">Academic conferences in Nepal and beyond</p>
            )}
          </div>

          <h1
            id="home-hero-title"
            className="home-settle mt-5 max-w-[15ch] font-display text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.02em] text-brand sm:text-6xl lg:text-[4.4rem]"
            style={{ animationDelay: '140ms' }}
          >
            {headline}
          </h1>

          <p className="home-settle mt-6 max-w-[34rem] text-[17px] leading-relaxed text-text-muted sm:text-lg" style={{ animationDelay: '260ms' }}>
            {subheadline}
          </p>

          <div className="home-rise mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center" style={{ animationDelay: '360ms' }}>
            <button
              type="button"
              onClick={onExplore}
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-3.5 text-[15px] font-medium text-on-brand shadow-[0_10px_30px_-12px_rgb(16_28_50/0.6)] transition duration-300 hover:bg-brand-hover hover:shadow-[0_14px_34px_-12px_rgb(16_28_50/0.7)]"
            >
              Explore conferences
              <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1" />
            </button>
            <button
              type="button"
              onClick={onDiscover}
              className="inline-flex items-center justify-center rounded-full border border-brand/15 bg-white/70 px-6 py-3.5 text-[15px] font-medium text-brand backdrop-blur transition duration-300 hover:border-brand/35 hover:bg-white"
            >
              Discover the platform
            </button>
            <button
              type="button"
              onClick={onWatchDemo}
              className="group inline-flex items-center justify-center gap-2 px-2 py-3 text-[15px] font-medium text-text transition hover:text-indigo"
            >
              <PlayCircle size={20} aria-hidden="true" className="text-indigo transition-transform duration-300 group-hover:scale-110" />
              Watch the demo
            </button>
          </div>

          <dl
            className="home-rise mt-10 grid w-fit grid-cols-3 divide-x divide-brand/10 border-t border-brand/10 pt-6"
            style={{ animationDelay: '480ms' }}
          >
            <HeroStat label="Conferences" value={stats.conferences} />
            <HeroStat label="Open for abstracts" value={stats.open} />
            <HeroStat label="Tracks" value={stats.tracks} />
          </dl>
        </div>

        {/* Photograph with the real featured conference laid over it */}
        <div className="relative lg:pl-4">
          <figure className="home-unveil relative aspect-[4/3.4] overflow-hidden rounded-2xl bg-brand sm:aspect-[4/3] lg:aspect-[4/4.6]">
            {/* Portrait crop of a 3:2 photo renders ~1.5x the frame width, so request the retina source. */}
            <img
              ref={photoRef}
              src="/images/home/hero-audience-2400.webp"
              srcSet="/images/home/hero-audience-1200.webp 1200w, /images/home/hero-audience-2400.webp 2400w"
              sizes="(min-width: 1024px) 1040px, 130vw"
              width={2400}
              height={1600}
              alt="Attendees listening and taking notes during a conference session"
              fetchPriority="high"
              decoding="async"
              className="h-full w-full scale-[1.08] object-cover object-[35%_center] will-change-transform"
            />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-brand/45 to-transparent" aria-hidden="true" />
            <figcaption className="sr-only">Keynote session at an academic conference</figcaption>
          </figure>

          <div className="home-rise absolute -left-14 top-[30%] z-10 hidden xl:block" style={{ animationDelay: '1100ms' }}>
            <JourneyCard />
          </div>

          <div className="home-rise relative z-10 -mt-24 px-4 sm:absolute sm:bottom-6 sm:left-6 sm:right-auto sm:mt-0 sm:w-[min(420px,85%)] sm:px-0 lg:-left-10" style={{ animationDelay: '700ms' }}>
            <FeaturedCard conference={featured} abstracts={featuredAbstracts} abstractsOpen={featuredAbstractsOpen} loading={loading} />
          </div>
        </div>
      </div>
    </section>
  )
})
