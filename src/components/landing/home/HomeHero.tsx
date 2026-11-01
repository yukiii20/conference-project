import { useEffect, useRef, useState, memo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, EyeOff, MapPin, PlayCircle } from 'lucide-react'
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

function HeroStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 text-xs leading-tight text-text-muted sm:text-[13px]">{label}</dt>
      <dd className="font-display text-3xl font-semibold text-text sm:text-4xl">
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
  if (loading) return <div className="h-[168px] w-full animate-pulse rounded-2xl bg-white/70 shadow-pop" />
  if (!conference) {
    return (
      <div className="rounded-2xl border border-white/60 bg-white/85 p-5 shadow-pop backdrop-blur-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-ink">Coming soon</p>
        <p className="mt-2 font-display text-lg font-semibold leading-snug text-text">New conferences are announced here first.</p>
        <p className="mt-1 text-sm text-text-muted">Organising one? We'll set it up for you.</p>
      </div>
    )
  }
  const place = placeLabel(conference)
  return (
    <Link
      to={`/c/${conference.slug}`}
      className="group block rounded-2xl border border-white/60 bg-white/85 p-5 shadow-pop backdrop-blur-md transition duration-300 hover:-translate-y-1 hover:bg-white/95"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-ink">Featured conference</p>
        {abstractsOpen ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
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
      {/* Quiet editorial backdrop: a hairline grid fading out, and a warm wash behind the photograph. */}
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(to_right,rgb(16_28_50/0.05)_1px,transparent_1px)] [background-size:96px_100%] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <div className="absolute -right-40 top-10 h-[520px] w-[620px] rounded-full bg-gold/20 blur-3xl" />
        <div className="absolute -left-32 bottom-0 h-[380px] w-[480px] rounded-full bg-indigo/10 blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1fr_1.02fr] lg:gap-16 lg:pb-20 lg:pt-10">
        {/* Editorial column */}
        <div className="relative">
          <div className="home-rise flex items-center gap-3" style={{ animationDelay: '60ms' }}>
            <span className="home-draw h-px w-10 bg-gold-ink" style={{ animationDelay: '200ms' }} aria-hidden="true" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink sm:text-xs">
              Academic conferences, end to end
            </p>
          </div>

          <h1
            id="home-hero-title"
            className="home-settle mt-6 max-w-[16ch] font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.02em] text-brand sm:text-6xl lg:text-[4.6rem]"
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
            className="home-rise mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-brand/10 pt-6"
            style={{ animationDelay: '480ms' }}
          >
            <HeroStat label="Conferences" value={stats.conferences} />
            <HeroStat label="Open for abstracts" value={stats.open} />
            <HeroStat label="Tracks" value={stats.tracks} />
          </dl>
        </div>

        {/* Photograph with the real featured conference laid over it */}
        <div className="relative lg:pl-4">
          <figure className="home-unveil home-grain relative aspect-[4/3.4] overflow-hidden rounded-[28px] bg-brand shadow-[0_40px_80px_-40px_rgb(16_28_50/0.55)] sm:aspect-[4/3] lg:aspect-[4/4.6]">
            <img
              ref={photoRef}
              src="/images/home/hero-keynote-1600.webp"
              srcSet="/images/home/hero-keynote-800.webp 800w, /images/home/hero-keynote-1600.webp 1600w"
              sizes="(min-width: 1024px) 600px, 100vw"
              width={1600}
              height={1067}
              alt="A speaker addresses a packed lecture theatre during a conference session"
              fetchPriority="high"
              decoding="async"
              className="h-full w-full scale-[1.08] object-cover object-[60%_center] will-change-transform"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-brand/80 via-brand/10 to-transparent" aria-hidden="true" />
            <figcaption className="sr-only">Keynote session at an academic conference</figcaption>
          </figure>

          {/* Floating real-feature marker */}
          <div
            className="home-rise absolute -top-4 right-4 hidden sm:block lg:-right-4 lg:top-10"
            style={{ animationDelay: '900ms' }}
            aria-hidden="true"
          >
            <div className="home-drift flex items-center gap-2.5 rounded-full border border-white/70 bg-white/90 py-2 pl-2 pr-4 text-sm font-medium text-text shadow-pop backdrop-blur">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold-soft text-gold-ink">
                <EyeOff size={16} />
              </span>
              Double-blind peer review
            </div>
          </div>

          <div className="home-rise relative z-10 -mt-24 px-4 sm:absolute sm:bottom-6 sm:left-6 sm:right-auto sm:mt-0 sm:w-[min(420px,85%)] sm:px-0 lg:-left-10" style={{ animationDelay: '700ms' }}>
            <FeaturedCard conference={featured} abstracts={featuredAbstracts} abstractsOpen={featuredAbstractsOpen} loading={loading} />
          </div>
        </div>
      </div>
    </section>
  )
})
