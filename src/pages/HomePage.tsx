import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { LandingHeader } from '../components/landing/LandingHeader'
import { LandingFooter } from '../components/landing/LandingFooter'
import { FaqAccordion } from '../components/landing/FaqAccordion'
import { Reveal } from '../components/landing/Reveal'
import { BackToTopButton } from '../components/landing/BackToTopButton'
import { SuggestionBox } from '../components/landing/SuggestionBox'
import { HomeHero } from '../components/landing/home/HomeHero'
import { ConferenceDiscovery } from '../components/landing/home/ConferenceDiscovery'
import { ProductShowcase } from '../components/landing/home/ProductShowcase'
import { JourneyTimeline } from '../components/landing/home/JourneyTimeline'
import { RolesSection } from '../components/landing/home/RolesSection'
import { CommunitySection } from '../components/landing/home/CommunitySection'
import { NewsAndDates, buildKeyDates } from '../components/landing/home/NewsAndDates'
import { ContactSection } from '../components/landing/home/ContactSection'
import {
  scrollBehavior,
  todayDateString,
  windowState,
  type Announcement,
  type Conference,
  type DeadlineWindow,
  type PublicStats,
} from '../components/landing/home/homeData'
import { SITE } from '../content/site'
import { usePlatformSettings } from '../lib/platformSettings'

type SectionId = 'conferences' | 'features' | 'how-it-works' | 'faq' | 'contact'

// In document order — the scroll-spy walks them top to bottom.
const SECTION_IDS: SectionId[] = ['conferences', 'features', 'how-it-works', 'faq', 'contact']

type DeadlineRow = { conference_id: string; opens_at: string; closes_at: string | null }

function toWindowMap(rows: DeadlineRow[] | undefined): Map<string, DeadlineWindow> {
  return new Map((rows ?? []).map((d) => [d.conference_id, { opens_at: d.opens_at, closes_at: d.closes_at }]))
}

/** Create-or-update a <meta>/<link> in <head>. */
function setHeadTag(selector: string, create: () => HTMLElement, attr: string, value: string) {
  let tag = document.head.querySelector<HTMLElement>(selector)
  if (!tag) {
    tag = create()
    document.head.appendChild(tag)
  }
  tag.setAttribute(attr, value)
}

function metaTag(attrName: 'name' | 'property', key: string, content: string) {
  setHeadTag(
    `meta[${attrName}="${key}"]`,
    () => {
      const m = document.createElement('meta')
      m.setAttribute(attrName, key)
      return m
    },
    'content',
    content,
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
  const [abstractWindows, setAbstractWindows] = useState<Map<string, DeadlineWindow>>(new Map())
  const [registrationWindows, setRegistrationWindows] = useState<Map<string, DeadlineWindow>>(new Map())
  const [deadlinesLoaded, setDeadlinesLoaded] = useState(false)
  const [trackCount, setTrackCount] = useState<number | null>(null)
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
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

  // ---- SEO: title, description, canonical, Open Graph -----------------------
  useEffect(() => {
    const url = `${window.location.origin}/`
    document.title = SITE.seo.title
    metaTag('name', 'description', SITE.seo.description)
    metaTag('property', 'og:title', SITE.seo.title)
    metaTag('property', 'og:description', SITE.seo.description)
    metaTag('property', 'og:url', url)
    metaTag('property', 'og:image', `${window.location.origin}/og-image.png`)
    metaTag('name', 'twitter:title', SITE.seo.title)
    metaTag('name', 'twitter:description', SITE.seo.description)
    setHeadTag(
      'link[rel="canonical"]',
      () => {
        const l = document.createElement('link')
        l.setAttribute('rel', 'canonical')
        return l
      },
      'href',
      url,
    )
  }, [])

  const loadConferences = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ conferences: Conference[] }>('/conferences/public')
      if (!mountedRef.current) return
      setConferences(Array.isArray(data?.conferences) ? data.conferences : [])
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof ApiError ? err.message : 'Could not load conferences.')
    } finally {
      if (mountedRef.current) setLoading(false)
    }

    // The rest are quiet extras: if one fails, the page simply shows less.
    const [abstracts, registration, tracks, platformStats] = await Promise.allSettled([
      api.get<{ deadlines: DeadlineRow[] }>('/conferences/public-deadlines', { deadline_type: 'abstract_submission' }),
      api.get<{ deadlines: DeadlineRow[] }>('/conferences/public-deadlines', { deadline_type: 'registration' }),
      api.get<{ count: number }>('/conferences/public-track-count'),
      api.get<PublicStats>('/conferences/public-stats'),
    ])
    if (!mountedRef.current) return
    if (abstracts.status === 'fulfilled') setAbstractWindows(toWindowMap(abstracts.value?.deadlines))
    if (registration.status === 'fulfilled') setRegistrationWindows(toWindowMap(registration.value?.deadlines))
    setDeadlinesLoaded(true)
    if (tracks.status === 'fulfilled') setTrackCount(tracks.value.count)
    if (platformStats.status === 'fulfilled') setStats(platformStats.value)
  }, [])

  useEffect(() => {
    loadConferences()
  }, [loadConferences])

  useEffect(() => {
    let cancelled = false
    api
      .get<{ announcements: Announcement[] }>('/announcements/public', { limit: '3' })
      .then((data) => {
        if (!cancelled) setAnnouncements(Array.isArray(data?.announcements) ? data.announcements : [])
      })
      .catch(() => {
        // Quiet feature: the section hides itself.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ---- Header height + scroll-spy ------------------------------------------
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => setHeaderHeight(el.getBoundingClientRect().height)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let ticking = false
    function computeActiveSection(): SectionId {
      const threshold = headerHeight + 8
      let current: SectionId = SECTION_IDS[0]
      for (const id of SECTION_IDS) {
        const el = sectionRefs.current[id]
        if (el && el.getBoundingClientRect().top <= threshold) current = id
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) current = SECTION_IDS[SECTION_IDS.length - 1]
      return current
    }
    function onScrollOrResize() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        if (!ignoreSpyRef.current) setActiveSection(computeActiveSection())
        ticking = false
      })
    }
    window.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize)
    onScrollOrResize()
    return () => {
      window.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [headerHeight, conferences])

  // Deep links (/#faq, /#suggestions from the footer on other pages).
  useEffect(() => {
    if (initialHashHandledRef.current || headerHeight === 0) return
    initialHashHandledRef.current = true
    const hash = window.location.hash.replace('#', '')
    if (!hash) return
    const el = sectionRefs.current[hash] ?? document.getElementById(hash)
    if (!el) return
    el.scrollIntoView({ behavior: 'auto', block: 'start' })
    if (SECTION_IDS.includes(hash as SectionId)) setActiveSection(hash as SectionId)
  }, [headerHeight])

  const handleNavigate = useCallback((id: string) => {
    const el = sectionRefs.current[id] ?? document.getElementById(id)
    if (!el) return
    if (SECTION_IDS.includes(id as SectionId)) setActiveSection(id as SectionId)
    ignoreSpyRef.current = true
    if (ignoreSpyTimeoutRef.current) window.clearTimeout(ignoreSpyTimeoutRef.current)
    el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    window.history.replaceState(null, '', `#${id}`)
    function stopIgnoring() {
      ignoreSpyRef.current = false
      window.removeEventListener('scrollend', stopIgnoring)
      if (ignoreSpyTimeoutRef.current) window.clearTimeout(ignoreSpyTimeoutRef.current)
    }
    window.addEventListener('scrollend', stopIgnoring, { once: true })
    ignoreSpyTimeoutRef.current = window.setTimeout(stopIgnoring, 900)
  }, [])

  function handleWatchDemo() {
    demoSectionRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    const video = demoVideoRef.current
    if (video) {
      video.focus({ preventScroll: true })
      video.play().catch(() => {
        // Autoplay can still be blocked; the visible controls are the fallback.
      })
    }
  }

  // ---- Derived data ----------------------------------------------------------
  const today = todayDateString()
  const openIds = useMemo(
    () => new Set(conferences.filter((c) => windowState(abstractWindows.get(c.id)) === 'open').map((c) => c.id)),
    [conferences, abstractWindows],
  )
  // Featured: the soonest conference that hasn't ended, preferring one open for abstracts.
  const upcoming = conferences.filter((c) => c.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date))
  const featured = upcoming.find((c) => openIds.has(c.id)) ?? upcoming[0] ?? null
  const keyDates = useMemo(() => buildKeyDates(conferences, abstractWindows, registrationWindows), [conferences, abstractWindows, registrationWindows])
  const windows = useMemo(() => ({ abstracts: abstractWindows, registration: registrationWindows }), [abstractWindows, registrationWindows])

  // Structured data: the site, plus the real upcoming conferences as Events.
  const structuredData = useMemo(() => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin
    const graph: unknown[] = [
      { '@type': 'WebSite', name: SITE.name, url: `${origin}/`, description: SITE.seo.description },
      { '@type': 'Organization', name: SITE.name, url: `${origin}/`, logo: `${origin}/logo.png`, email: contactEmail },
      ...upcoming.slice(0, 10).map((c) => ({
        '@type': 'Event',
        name: c.name,
        startDate: c.start_date,
        endDate: c.end_date,
        url: `${origin}/c/${c.slug}`,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        ...(c.theme || c.tagline ? { description: c.theme || c.tagline } : {}),
        ...(c.city || c.venue_name
          ? { location: { '@type': 'Place', name: c.venue_name || c.city, address: [c.city, c.country].filter(Boolean).join(', ') } }
          : {}),
      })),
    ]
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
  }, [upcoming, contactEmail])

  const sectionRef = (id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el
  }
  const scrollMargin = { scrollMarginTop: headerHeight }

  return (
    <div className="min-h-screen overflow-x-clip bg-page-bg text-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-brand focus:shadow-lg"
      >
        Skip to main content
      </a>

      <LandingHeader ref={headerRef} activeSection={activeSection} onNavigate={handleNavigate} />

      <main id="main-content">
        <HomeHero
          headline={heroHeadline}
          subheadline={heroSubheadline}
          featured={featured}
          featuredAbstracts={featured ? abstractWindows.get(featured.id) : undefined}
          featuredAbstractsOpen={featured ? openIds.has(featured.id) : false}
          loading={loading && !error}
          stats={{
            conferences: loading ? null : conferences.length,
            open: deadlinesLoaded ? openIds.size : null,
            tracks: trackCount,
          }}
          onExplore={() => handleNavigate('conferences')}
          onDiscover={() => handleNavigate('features')}
          onWatchDemo={handleWatchDemo}
        />

        <section id="conferences" ref={sectionRef('conferences')} style={scrollMargin} className="border-t border-brand/[0.07] bg-gradient-to-b from-surface/70 to-page-bg">
          <ConferenceDiscovery
            conferences={conferences}
            windows={windows}
            featuredId={featured?.id ?? null}
            loading={loading}
            error={error}
            onRetry={loadConferences}
            onContact={() => handleNavigate('contact')}
          />
        </section>

        <section aria-label="News and key dates" className="border-t border-brand/[0.07]">
          <NewsAndDates announcements={announcements} keyDates={keyDates} />
        </section>

        <section id="features" ref={sectionRef('features')} style={scrollMargin} aria-label="The platform">
          <ProductShowcase />
        </section>

        <section
          id="demo"
          ref={(el) => {
            demoSectionRef.current = el
          }}
          style={scrollMargin}
          className="bg-gradient-to-b from-brand to-page-bg to-[55%]"
        >
          <div className="mx-auto max-w-[1240px] px-4 pb-24 sm:px-6 lg:pb-28">
            <Reveal>
              <div className="mx-auto max-w-2xl text-center text-white">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Product tour</p>
                <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em] sm:text-5xl">See it in action</h2>
                <p className="mt-4 text-lg leading-relaxed text-white/70">Two minutes, from submitting a paper to downloading a certificate.</p>
              </div>
            </Reveal>
            <Reveal variant="image" delay={120}>
              <div className="mx-auto mt-12 max-w-[1040px] rounded-[26px] bg-white/10 p-2 shadow-[0_50px_100px_-40px_rgb(16_28_50/0.7)] ring-1 ring-white/15 backdrop-blur sm:p-3">
                <div className="aspect-video overflow-hidden rounded-[18px] bg-brand">
                  <video ref={demoVideoRef} controls playsInline preload="none" poster="/video/poster.jpg" className="h-full w-full">
                    <source src="/video/product-video-web.mp4" type="video/mp4" />
                    <track kind="captions" src="/video/demo.vtt" srcLang="en" label="English" default />
                  </video>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="how-it-works" ref={sectionRef('how-it-works')} style={scrollMargin} className="border-t border-brand/[0.07]" aria-label="How it works">
          <JourneyTimeline />
        </section>

        <section id="roles" style={scrollMargin} className="bg-gradient-to-b from-surface-muted/50 to-page-bg" aria-label="Roles">
          <RolesSection />
        </section>

        <section id="community" style={scrollMargin} aria-label="Academic community">
          <CommunitySection stats={stats} tracks={trackCount} />
        </section>

        <section id="faq" ref={sectionRef('faq')} style={scrollMargin} className="border-t border-brand/[0.07]">
          <div className="mx-auto grid max-w-[1240px] gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:py-28">
            <Reveal>
              <div className="lg:sticky lg:top-28">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">Help</p>
                <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em] text-brand sm:text-5xl">{SITE.faq.heading}</h2>
                <p className="mt-4 max-w-sm text-lg leading-relaxed text-text-muted">Can't find what you're looking for? Write to us and we'll get back to you.</p>
                <a
                  href={contactGmailHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center gap-2 break-all font-medium text-indigo underline-offset-4 hover:underline"
                >
                  {contactEmail}
                </a>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <FaqAccordion items={faqItems} />
            </Reveal>
          </div>
        </section>

        <section id="contact" ref={sectionRef('contact')} style={scrollMargin} className="pb-8">
          <ContactSection email={contactEmail} onFeedback={() => handleNavigate('suggestions')} />
        </section>

        <SuggestionBox />
      </main>

      <LandingFooter />
      <BackToTopButton />
    </div>
  )
}
