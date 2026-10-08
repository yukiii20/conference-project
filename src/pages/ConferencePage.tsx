import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { publicImageUrl } from '../lib/storage'
import { formatDateRange, formatKathmandu, formatKathmanduTime, kathmanduDateKey } from '../lib/datetime'
import { DEFAULT_CONFERENCE_COLOR, getAccessibleTextColor } from '../lib/color'
import { SUPPORTER_TIERS, type SupporterTier } from '../lib/validation'
import { ConferenceNav, SECTIONS, type SectionId } from './conference/ConferenceNav'
import { ConferenceOpeningScene } from '../components/ConferenceOpeningScene'
import { DEADLINE_LABELS, type Conference, type Deadline, type ScheduleRow, type Supporter, type Track } from './conference/types'

const TIER_LABELS: Record<SupporterTier, string> = {
  organizer: 'Organizers',
  co_organizer: 'Co-organizers',
  sponsor: 'Sponsors',
  partner: 'Partners',
  media: 'Media partners',
}

function groupByDay(rows: ScheduleRow[]) {
  const groups = new Map<string, ScheduleRow[]>()
  for (const row of rows) {
    const key = kathmanduDateKey(row.session_starts_at)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayRows]) => ({
      key,
      label: formatKathmandu(dayRows[0].session_starts_at, { dateOnly: true }),
      rows: dayRows,
    }))
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

export function ConferencePage() {
  const { slug } = useParams<{ slug: string }>()
  const [conference, setConference] = useState<Conference | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [supporters, setSupporters] = useState<Supporter[]>([])
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('home')
  const [introDone, setIntroDone] = useState(false)
  const [headerHeight, setHeaderHeight] = useState(0)

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const headerRef = useRef<HTMLElement | null>(null)
  const ignoreSpyRef = useRef(false)
  const ignoreSpyTimeoutRef = useRef<number | undefined>(undefined)
  const initialHashHandledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setIntroDone(false)

    async function load() {
      setLoading(true)
      const { data: conf, error: confError } = await supabase
        .from('conferences')
        .select(
          'id, slug, code, name, tagline, theme, description, start_date, end_date, city, country, logo_path, banner_path, primary_color, venue_name, address, location_map_url, contact_email, contact_phone, website_url',
        )
        .eq('slug', slug ?? '')
        .neq('status', 'draft')
        .is('deleted_at', null)
        .maybeSingle()

      if (cancelled) return

      if (confError) {
        setError(confError.message)
        setLoading(false)
        return
      }
      if (!conf) {
        setConference(null)
        setLoading(false)
        return
      }
      setConference(conf as Conference)

      const [{ data: tracksData }, { data: supportersData }, { data: deadlinesData }, { data: scheduleData }] =
        await Promise.all([
          supabase.from('conference_tracks').select('id, name, description').eq('conference_id', conf.id).eq('is_active', true).order('display_order'),
          supabase
            .from('conference_supporters')
            .select('id, name, tier, logo_path, website_url')
            .eq('conference_id', conf.id)
            .eq('is_active', true)
            .order('display_order'),
          supabase
            .from('conference_deadlines')
            .select('deadline_type, opens_at, closes_at')
            .eq('conference_id', conf.id)
            .eq('is_public', true),
          supabase.rpc('get_public_schedule', { p_conference_id: conf.id }),
        ])

      if (cancelled) return

      setTracks((tracksData ?? []) as Track[])
      setSupporters((supportersData ?? []) as Supporter[])
      setDeadlines((deadlinesData ?? []) as Deadline[])

      const rows = (scheduleData ?? []) as ScheduleRow[]
      const bySession = new Map<string, ScheduleRow>()
      for (const row of rows) {
        if (!bySession.has(row.session_id)) bySession.set(row.session_id, row)
      }
      setSchedule(Array.from(bySession.values()).sort((a, b) => a.session_starts_at.localeCompare(b.session_starts_at)))

      setError(null)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    if (!conference) return
    const prevTitle = document.title
    document.title = conference.name
    setMetaDescription(conference.tagline ?? conference.theme ?? conference.name)
    return () => {
      document.title = prevTitle
    }
  }, [conference])

  // Measure the sticky header's real height (never hard-coded) so sections can
  // reserve that much scroll-margin-top, and the scroll-spy threshold matches it.
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
    const elements = SECTIONS.map((s) => sectionRefs.current[s.id]).filter((el): el is HTMLElement => Boolean(el))
    let current: SectionId = SECTIONS[0].id
    for (const el of elements) {
      if (el.getBoundingClientRect().top <= threshold) {
        current = el.id as SectionId
      }
    }
    const scrolledToBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
    if (scrolledToBottom) {
      current = SECTIONS[SECTIONS.length - 1].id
    }
    return current
  }

  // Active section = the LAST section whose top edge has passed the line just
  // below the header, recalculated on scroll/resize (rAF-throttled) — not an
  // IntersectionObserver "most visible" heuristic, which mis-highlights short
  // or adjacent sections.
  useEffect(() => {
    if (!conference) return
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
  }, [conference, tracks, supporters, deadlines, schedule, headerHeight])

  // Scroll to a section on load if the URL already has a matching hash.
  useEffect(() => {
    if (!conference || initialHashHandledRef.current || headerHeight === 0) return
    initialHashHandledRef.current = true
    const hash = window.location.hash.replace('#', '')
    if (!hash || !SECTIONS.some((s) => s.id === hash)) return
    const el = sectionRefs.current[hash]
    if (!el) return
    el.scrollIntoView({ behavior: 'auto', block: 'start' })
    setActiveSection(hash as SectionId)
  }, [conference, headerHeight])

  function handleNavigate(id: SectionId) {
    const el = sectionRefs.current[id]
    if (!el) return

    setActiveSection(id)
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-ink">
        <p className="text-sm text-ink/60">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-ink">
        <div className="max-w-md rounded-xl border border-line bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  if (!conference) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-ink">
        <div className="max-w-md rounded-xl border border-line bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Conference not found</h1>
          <p className="mt-2 text-sm text-ink/70">This conference doesn't exist or hasn't been published yet.</p>
          <Link to="/" className="mt-6 inline-block font-medium text-button underline">
            ← Back to all conferences
          </Link>
        </div>
      </div>
    )
  }

  const accent = conference.primary_color ?? DEFAULT_CONFERENCE_COLOR
  const accentText = getAccessibleTextColor(accent)
  const logoUrl = publicImageUrl(conference.logo_path)
  const bannerUrl = publicImageUrl(conference.banner_path)
  const groupedSchedule = groupByDay(schedule)
  const groupedSupporters = SUPPORTER_TIERS.map((tier) => ({
    tier,
    items: supporters.filter((s) => s.tier === tier),
  })).filter((g) => g.items.length > 0)

  const signupHref = `/signup?conference=${conference.slug}`

  const nowMs = Date.now()
  const nextDeadline = deadlines
    .map((d) => ({ ...d, at: d.closes_at ?? d.opens_at }))
    .filter((d) => new Date(d.at).getTime() >= nowMs)
    .sort((a, b) => a.at.localeCompare(b.at))[0]
  const daysUntilNext = nextDeadline ? Math.ceil((new Date(nextDeadline.at).getTime() - nowMs) / 86400000) : null

  const sectionStyle = { scrollMarginTop: headerHeight + 8 }

  return (
    <div style={{ '--conf-color': accent } as React.CSSProperties} className="min-h-screen bg-background text-ink">
      <ConferenceNav
        ref={headerRef}
        conference={conference}
        tracks={tracks}
        supporters={supporters}
        schedule={schedule}
        deadlines={deadlines}
        accent={accent}
        accentText={accentText}
        logoUrl={logoUrl}
        signupHref={signupHref}
        activeSection={activeSection}
        onNavigate={handleNavigate}
      />

      <section
        id="home"
        ref={(el) => {
          sectionRefs.current.home = el
        }}
        style={sectionStyle}
        className="relative overflow-hidden"
      >
        {bannerUrl ? (
          <>
            <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-black/60" />
          </>
        ) : (
          <div className="absolute inset-0" style={{ backgroundColor: accent }} />
        )}
        <div
          className="relative mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 py-14 text-center md:flex-row md:items-center md:gap-10 md:text-left"
          style={{ color: bannerUrl ? '#ffffff' : accentText }}
        >
          <div className="w-full md:max-w-[480px] md:flex-1">
            <ConferenceOpeningScene
              key={conference.slug}
              title={`Welcome to ${conference.name}`}
              subtitle={[conference.theme, formatDateRange(conference.start_date, conference.end_date), conference.city]
                .filter(Boolean)
                .join(' · ')}
              laptopLabel={conference.code}
              color={conference.primary_color ?? undefined}
              storageKey={conference.slug}
              onDone={() => setIntroDone(true)}
            />
          </div>

          <div className="w-full md:flex-1">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${conference.name} logo`}
                className="mx-auto h-24 w-24 object-contain md:mx-0"
              />
            ) : null}
            <h1 className="mt-4 text-3xl font-bold sm:text-4xl">{conference.name}</h1>
            {conference.tagline ? <p className="mt-2 text-lg opacity-90">{conference.tagline}</p> : null}
            {conference.theme ? <p className="mt-1 opacity-80">{conference.theme}</p> : null}
            <p className="mt-4 opacity-90">
              {formatDateRange(conference.start_date, conference.end_date)}
              {conference.venue_name ? ` · ${conference.venue_name}` : ''}
              {conference.city ? ` · ${conference.city}` : ''}
            </p>
            <div
              className={`mt-8 flex flex-wrap items-center justify-center gap-3 transition-opacity duration-700 md:justify-start ${
                introDone ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <Link
                to={signupHref}
                style={{ backgroundColor: bannerUrl ? accent : '#ffffff', color: bannerUrl ? accentText : accent }}
                className="rounded-md px-5 py-2.5 font-medium hover:opacity-90"
              >
                Submit an abstract
              </Link>
              <Link
                to={signupHref}
                className="rounded-md border px-5 py-2.5 font-medium hover:bg-white/10"
                style={{ borderColor: bannerUrl || accentText === '#ffffff' ? '#ffffff' : accent, color: bannerUrl ? '#ffffff' : accentText }}
              >
                Register
              </Link>
              <Link
                to="/login"
                className="rounded-md border px-5 py-2.5 font-medium hover:bg-white/10"
                style={{ borderColor: bannerUrl || accentText === '#ffffff' ? '#ffffff' : accent, color: bannerUrl ? '#ffffff' : accentText }}
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section
        id="about"
        ref={(el) => {
          sectionRefs.current.about = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-3xl px-4 py-12"
      >
        <h2 className="text-2xl font-semibold">About</h2>
        {conference.description ? (
          <p className="mt-4 whitespace-pre-line text-ink/80">{conference.description}</p>
        ) : (
          <p className="mt-4 text-sm text-ink/60">No description yet.</p>
        )}

        {tracks.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Tracks</h3>
            <ul className="mt-3 space-y-2">
              {tracks.map((t) => (
                <li key={t.id} className="rounded-md border border-line bg-white p-3 text-sm">
                  <p className="font-medium text-ink">{t.name}</p>
                  {t.description ? <p className="mt-1 text-ink/70">{t.description}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section
        id="supporters"
        ref={(el) => {
          sectionRefs.current.supporters = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-5xl px-4 py-12"
      >
        <h2 className="text-2xl font-semibold">Supporters</h2>
        {groupedSupporters.length === 0 ? (
          <p className="mt-4 text-sm text-ink/60">Supporters will be announced soon.</p>
        ) : (
          <div className="mt-6 space-y-8">
            {groupedSupporters.map((group) => (
              <div key={group.tier}>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/50">{TIER_LABELS[group.tier]}</h3>
                <div className="mt-3 flex flex-wrap items-center gap-6">
                  {group.items.map((s) => {
                    const url = publicImageUrl(s.logo_path)
                    const content = url ? (
                      <img src={url} alt={s.name} className="h-16 max-w-[160px] object-contain" />
                    ) : (
                      <span className="text-ink/70">{s.name}</span>
                    )
                    return s.website_url ? (
                      <a key={s.id} href={s.website_url} target="_blank" rel="noopener noreferrer" title={s.name} className="opacity-90 transition hover:opacity-100">
                        {content}
                      </a>
                    ) : (
                      <span key={s.id} title={s.name}>
                        {content}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        id="programme"
        ref={(el) => {
          sectionRefs.current.programme = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-5xl px-4 py-12"
      >
        <h2 className="text-2xl font-semibold">Programme</h2>
        {groupedSchedule.length === 0 ? (
          <p className="mt-4 text-sm text-ink/60">The programme will be announced soon.</p>
        ) : (
          <div className="mt-6 space-y-8">
            {groupedSchedule.map((day) => (
              <div key={day.key}>
                <h3 className="font-semibold text-ink">{day.label}</h3>
                <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-ink/60">
                        <th className="px-4 py-2 font-medium">Time</th>
                        <th className="px-4 py-2 font-medium">Title</th>
                        <th className="px-4 py-2 font-medium">Type</th>
                        <th className="px-4 py-2 font-medium">Track</th>
                        <th className="px-4 py-2 font-medium">Room</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {day.rows.map((row) => (
                        <tr key={row.session_id}>
                          <td className="whitespace-nowrap px-4 py-2">
                            {formatKathmanduTime(row.session_starts_at)} – {formatKathmanduTime(row.session_ends_at)}
                          </td>
                          <td className="px-4 py-2">{row.session_title}</td>
                          <td className="px-4 py-2 capitalize">{row.session_type}</td>
                          <td className="px-4 py-2">{row.track_name ?? '—'}</td>
                          <td className="px-4 py-2">{row.room_name ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        id="location"
        ref={(el) => {
          sectionRefs.current.location = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-5xl px-4 py-12"
      >
        <h2 className="text-2xl font-semibold">Location</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            {conference.venue_name ? <p className="font-medium text-ink">{conference.venue_name}</p> : null}
            {conference.address ? <p className="mt-1 text-ink/70">{conference.address}</p> : null}
            {conference.city || conference.country ? (
              <p className="mt-1 text-ink/70">{[conference.city, conference.country].filter(Boolean).join(', ')}</p>
            ) : null}
            {!conference.venue_name && !conference.address ? (
              <p className="text-sm text-ink/60">Venue details will be announced soon.</p>
            ) : null}
          </div>
          {conference.location_map_url ? (
            <iframe src={conference.location_map_url} title="Venue location map" loading="lazy" className="h-72 w-full rounded-lg border border-line" />
          ) : null}
        </div>
      </section>

      <section
        id="key-dates"
        ref={(el) => {
          sectionRefs.current['key-dates'] = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-5xl px-4 py-12"
      >
        <h2 className="text-2xl font-semibold">Key dates</h2>
        {nextDeadline && daysUntilNext !== null ? (
          <p className="mt-2 text-sm font-medium" style={{ color: accent }}>
            Next deadline: {DEADLINE_LABELS[nextDeadline.deadline_type] ?? nextDeadline.deadline_type} in{' '}
            {daysUntilNext === 0 ? 'less than a day' : `${daysUntilNext} day${daysUntilNext === 1 ? '' : 's'}`}
          </p>
        ) : null}
        {deadlines.length === 0 ? (
          <p className="mt-4 text-sm text-ink/60">Key dates will be announced soon.</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink/60">
                  <th className="px-4 py-2 font-medium">Milestone</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {deadlines
                  .slice()
                  .sort((a, b) => a.opens_at.localeCompare(b.opens_at))
                  .map((d) => {
                    const closes = d.closes_at ?? d.opens_at
                    const isPast = new Date(closes).getTime() < Date.now()
                    return (
                      <tr key={d.deadline_type}>
                        <td className="px-4 py-2">{DEADLINE_LABELS[d.deadline_type] ?? d.deadline_type}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{formatKathmandu(closes)}</td>
                        <td className="px-4 py-2">{isPast ? <span className="text-ink/50">Closed</span> : <span className="text-green-700">Open</span>}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-ink/70">
          <p className="font-medium text-ink">{conference.name}</p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            {conference.contact_email ? (
              <a href={`mailto:${conference.contact_email}`} className="hover:text-button">
                {conference.contact_email}
              </a>
            ) : null}
            {conference.contact_phone ? <span>{conference.contact_phone}</span> : null}
            {conference.website_url ? (
              <a href={conference.website_url} target="_blank" rel="noopener noreferrer" className="hover:text-button">
                {conference.website_url}
              </a>
            ) : null}
          </div>
          <Link to="/" className="mt-4 inline-block text-ink/60 underline">
            ← All conferences
          </Link>
        </div>
      </footer>
    </div>
  )
}
