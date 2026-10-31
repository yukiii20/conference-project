import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { publicImageUrl } from '../lib/storage'
import { formatDateRange, formatKathmandu, formatKathmanduTime, kathmanduDateKey } from '../lib/datetime'
import { DEFAULT_CONFERENCE_COLOR, darken, getAccessibleTextColor, hexToRgba } from '../lib/color'
import { SUPPORTER_TIERS, type SupporterTier } from '../lib/validation'
import { ConferenceNav, SECTIONS, type SectionId } from './conference/ConferenceNav'
import { RegistrationPanel } from './conference/RegistrationPanel'
import { ConferenceBadgeAnimation } from '../components/ConferenceBadgeAnimation'
import { StarButton } from '../components/agenda/StarButton'
import { useAgendaStars } from '../components/agenda/useAgendaStars'
import { usePublicAbstractBook } from '../components/abstractBook/usePublicAbstractBook'
import { Markdown } from '../components/Markdown'
import {
  DEADLINE_LABELS,
  type Committee,
  type Conference,
  type ConferenceAnnouncement,
  type Deadline,
  type ScheduleRow,
  type Speaker,
  type Supporter,
  type Track,
} from './conference/types'

const TIER_LABELS: Record<SupporterTier, string> = {
  organizer: 'Organizers',
  co_organizer: 'Co-organizers',
  sponsor: 'Sponsors',
  partner: 'Partners',
  knowledge_partner: 'Knowledge partners',
  media: 'Media partners',
}

function groupByDay(rows: ScheduleRow[]) {
  const groups = new Map<string, ScheduleRow[]>()
  for (const row of rows) {
    const key = kathmanduDateKey(row.starts_at)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayRows]) => ({
      key,
      label: formatKathmandu(dayRows[0].starts_at, { dateOnly: true }),
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
  const [committees, setCommittees] = useState<Committee[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [announcements, setAnnouncements] = useState<ConferenceAnnouncement[]>([])
  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('home')
  const [introDone, setIntroDone] = useState(false)
  const [bannerFailed, setBannerFailed] = useState(false)
  const [headerHeight, setHeaderHeight] = useState(0)
  const agendaStars = useAgendaStars(conference?.id ?? null)
  const abstractBook = usePublicAbstractBook(conference?.id ?? null)

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

      let result:
        | {
            conference: Conference
            tracks: Track[]
            deadlines: Deadline[]
            supporters: Supporter[]
            committees: Committee[]
            speakers: Speaker[]
            announcements: ConferenceAnnouncement[]
          }
        | null = null
      try {
        result = await api.get(`/conferences/${slug ?? ''}`)
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setConference(null)
          setLoading(false)
          return
        }
        setError(err instanceof ApiError ? err.message : 'Could not load this conference.')
        setLoading(false)
        return
      }

      if (cancelled || !result) return
      setConference(result.conference)
      setTracks(result.tracks)
      setSupporters(result.supporters)
      setDeadlines(result.deadlines)
      setCommittees(result.committees)
      setSpeakers(result.speakers)
      setAnnouncements(result.announcements)

      const scheduleData = await api
        .get<{ schedule: ScheduleRow[] }>(`/conferences/${result.conference.id}/sessions/public`)
        .catch(() => ({ schedule: [] as ScheduleRow[] }))
      if (cancelled) return

      setSchedule([...scheduleData.schedule].sort((a, b) => a.starts_at.localeCompare(b.starts_at)))

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
  const bannerUrl = bannerFailed ? null : publicImageUrl(conference.banner_path)
  // Over a banner image the overlay is dark regardless of the convenor's colour, so white
  // text always reads; without a banner the background IS the raw accent, so pick the text
  // colour the same way the nav does.
  const heroOverlayColor = darken(accent, 0.75)
  const heroTextColor = bannerUrl ? '#ffffff' : accentText
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
            <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setBannerFailed(true)} />
            <div className="absolute inset-0" style={{ backgroundColor: hexToRgba(heroOverlayColor, 0.65) }} />
          </>
        ) : (
          <>
            <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(135deg, ${accent} 0%, ${darken(accent, 0.35)} 100%)` }} />
            <div
              className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
              aria-hidden="true"
            />
          </>
        )}
        <div
          className="relative mx-auto flex max-w-7xl flex-col items-center gap-8 px-4 py-16 text-center sm:px-6 md:flex-row md:items-center md:gap-12 md:py-20 md:text-left"
          style={{ color: heroTextColor }}
        >
          <div className="flex w-full justify-center md:w-auto md:flex-none">
            <ConferenceBadgeAnimation
              key={conference.slug}
              code={conference.code}
              name={conference.name}
              shortName={conference.short_name}
              logoUrl={logoUrl}
              color={accent}
              onDone={() => setIntroDone(true)}
            />
          </div>

          <div className="w-full md:flex-1">
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{conference.name}</h1>
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
                style={{ backgroundColor: '#ffffff', color: accent }}
                className="rounded-xl px-5 py-3 font-medium shadow-sm hover:opacity-90"
              >
                Submit an abstract
              </Link>
              <Link
                to={signupHref}
                style={{ borderColor: heroTextColor, color: heroTextColor }}
                className="rounded-md border px-5 py-2.5 font-medium hover:bg-white/10"
              >
                Register
              </Link>
              <Link
                to="/login"
                style={{ borderColor: heroTextColor, color: heroTextColor }}
                className="rounded-md border px-5 py-2.5 font-medium hover:bg-white/10"
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
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6"
      >
        <div className="grid gap-8 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">About {conference.name}</h2>
            {conference.tagline ? (
              <p className="mt-2 text-lg font-medium text-ink/70">{conference.tagline}</p>
            ) : null}
            {conference.welcome_text ? (
              <Markdown source={conference.welcome_text} className="mt-4 max-w-prose text-ink/80" />
            ) : null}
            {conference.description ? (
              <p className="mt-4 max-w-prose whitespace-pre-line leading-relaxed text-ink/80">{conference.description}</p>
            ) : conference.welcome_text ? null : (
              <p className="mt-4 text-sm text-ink/60">No description yet.</p>
            )}
          </div>
          {conference.banner_path && !bannerFailed ? (
            <img
              onError={() => setBannerFailed(true)}
              src={publicImageUrl(conference.banner_path) ?? undefined}
              alt={`${conference.name} banner`}
              loading="lazy"
              className="max-h-80 w-full rounded-2xl object-cover shadow-card"
            />
          ) : null}
        </div>

        {tracks.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Tracks</h3>
            <ul className="mt-3 space-y-2">
              {tracks.map((t) => (
                <li key={t.id} className="rounded-xl border border-border-soft bg-surface shadow-card p-3 text-sm">
                  <p className="font-medium text-ink">{t.name}</p>
                  {t.description ? <p className="mt-1 text-ink/70">{t.description}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {conference.submission_guidelines ? (
          <div id="submission-guidelines" className="mt-8 rounded-xl border border-border-soft bg-surface p-5 shadow-card sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-2xl font-semibold tracking-tight">Submission guidelines</h3>
              <Link
                to={signupHref}
                style={{ backgroundColor: accent, color: getAccessibleTextColor(accent) }}
                className="rounded-xl px-4 py-2 text-sm font-medium shadow-sm hover:opacity-90"
              >
                Submit an abstract
              </Link>
            </div>
            <Markdown source={conference.submission_guidelines} className="mt-4 max-w-prose text-ink/80" />
          </div>
        ) : null}
      </section>

      <section
        id="announcements"
        ref={(el) => {
          sectionRefs.current.announcements = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6"
      >
        <h2 className="font-display text-3xl font-semibold tracking-tight">Announcements</h2>
        {announcements.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-8 text-center text-sm text-ink/60">No announcements yet.</p>
        ) : (
          <ul className="mt-6 space-y-4">
            {announcements.map((a) => (
              <li key={a.id} className="rounded-xl border border-border-soft bg-surface shadow-card p-4">
                <p className="font-medium text-ink">{a.title}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-ink/70">{a.body}</p>
                <p className="mt-2 text-xs text-ink/50">{formatKathmandu(a.publish_at ?? a.created_at, { dateOnly: true })}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        id="committees"
        ref={(el) => {
          sectionRefs.current.committees = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6"
      >
        <h2 className="font-display text-3xl font-semibold tracking-tight">Committees</h2>
        {committees.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-8 text-center text-sm text-ink/60">Committees will be announced soon.</p>
        ) : (
          <div className="mt-6 space-y-8">
            {committees.map((c) => (
              <div key={c.id}>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/50">{c.name}</h3>
                {c.description ? <p className="mt-1 text-sm text-ink/70">{c.description}</p> : null}
                {c.members.length > 0 ? (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {c.members.map((m, i) => (
                      <li key={i} className="rounded-xl border border-border-soft bg-surface shadow-card p-3 text-sm">
                        <p className="font-medium text-ink">{m.member_name}</p>
                        <p className="text-xs text-ink/60">
                          {m.member_role.replace('_', '-')}
                          {m.affiliation ? ` · ${m.affiliation}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        id="speakers"
        ref={(el) => {
          sectionRefs.current.speakers = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6"
      >
        <h2 className="font-display text-3xl font-semibold tracking-tight">Speakers</h2>
        {speakers.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-8 text-center text-sm text-ink/60">Speakers will be announced soon.</p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {speakers.map((s) => {
              const photoUrl = publicImageUrl(s.photo_path)
              return (
                <div key={s.id} className="rounded-xl border border-border-soft bg-surface shadow-card p-4 text-center">
                  {photoUrl ? (
                    <img src={photoUrl} alt={s.full_name} className="mx-auto h-20 w-20 rounded-full object-cover" />
                  ) : (
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-background text-xl font-semibold text-ink/40">
                      {s.full_name.charAt(0)}
                    </div>
                  )}
                  <p className="mt-3 font-medium text-ink">{s.full_name}</p>
                  {s.designation ? <p className="text-xs text-ink/60">{s.designation}</p> : null}
                  {s.affiliation ? <p className="text-xs text-ink/50">{s.affiliation}</p> : null}
                  <span className="mt-2 inline-block rounded-full bg-background px-2 py-0.5 text-xs capitalize text-ink/60">
                    {s.speaker_type}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section
        id="supporters"
        ref={(el) => {
          sectionRefs.current.supporters = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6"
      >
        <h2 className="font-display text-3xl font-semibold tracking-tight">Supporters</h2>
        {groupedSupporters.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-8 text-center text-sm text-ink/60">Supporters will be announced soon.</p>
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
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Programme</h2>
          {groupedSchedule.length > 0 ? (
            <a
              href={`/api/conferences/${conference.id}/sessions/public/programme.pdf`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: accent }}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-background"
            >
              Download programme (PDF)
            </a>
          ) : null}
          {abstractBook.url ? (
            <a
              href={abstractBook.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: accent }}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-background"
            >
              Book of abstracts (PDF)
            </a>
          ) : null}
        </div>
        {groupedSchedule.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-8 text-center text-sm text-ink/60">The programme will be announced soon.</p>
        ) : (
          <div className="mt-6 space-y-8">
            {groupedSchedule.map((day) => (
              <div key={day.key}>
                <h3 className="font-semibold text-ink">{day.label}</h3>
                <div className="mt-3 space-y-3">
                  {day.rows.map((row) => (
                    <div key={row.id} className="rounded-xl border border-border-soft bg-surface shadow-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-ink">{row.title}</p>
                          <p className="text-sm text-ink/60">
                            {formatKathmanduTime(row.starts_at)} – {formatKathmanduTime(row.ends_at)}
                            {row.room ? ` · ${row.room.name}` : ''}
                            {row.track ? ` · ${row.track.name}` : ''}
                            <span className="capitalize"> · {row.session_type}</span>
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <a
                            href={`/api/conferences/${conference.id}/sessions/public/${row.id}/ics`}
                            style={{ color: accent }}
                            className="text-xs font-medium hover:underline"
                          >
                            Add to calendar
                          </a>
                          <StarButton
                            starred={agendaStars.starred.has(row.id)}
                            locked={!agendaStars.starred.has(row.id) && agendaStars.automatic.has(row.id)}
                            busy={agendaStars.busyId === row.id}
                            onToggle={() => agendaStars.toggle(row.id)}
                            accent={accent}
                            sessionTitle={row.title}
                          />
                        </div>
                      </div>
                      {row.description ? <p className="mt-2 text-sm text-ink/70">{row.description}</p> : null}
                      {row.chairs.length > 0 ? (
                        <p className="mt-2 text-xs text-ink/60">
                          Chair{row.chairs.length > 1 ? 's' : ''}: {row.chairs.map((c) => c.full_name).join(', ')}
                        </p>
                      ) : null}
                      {row.presentations.length > 0 ? (
                        <ul className="mt-2 space-y-1 border-t border-line pt-2 text-sm">
                          {row.presentations.map((p) => (
                            <li key={p.id}>
                              <span className="text-ink/50">{formatKathmanduTime(p.starts_at)}</span> {p.title}
                              {p.authors && p.authors.length > 0 ? (
                                <span className="text-ink/60"> — {p.authors.join(', ')}</span>
                              ) : p.speaker_name ? (
                                <span className="text-ink/60"> — {p.speaker_name}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        id="registration"
        ref={(el) => {
          sectionRefs.current.registration = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6"
      >
        <h2 className="font-display text-3xl font-semibold tracking-tight">Registration</h2>
        <div className="mt-4">
          <RegistrationPanel conferenceId={conference.id} accent={accent} contactEmail={conference.contact_email} />
        </div>
      </section>

      <section
        id="location"
        ref={(el) => {
          sectionRefs.current.location = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6"
      >
        <h2 className="font-display text-3xl font-semibold tracking-tight">Location</h2>
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
            <iframe src={conference.location_map_url} title="Venue location map" loading="lazy" className="h-72 w-full rounded-2xl border border-border-soft shadow-card" />
          ) : null}
        </div>
      </section>

      <section
        id="key-dates"
        ref={(el) => {
          sectionRefs.current['key-dates'] = el
        }}
        style={sectionStyle}
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6"
      >
        <h2 className="font-display text-3xl font-semibold tracking-tight">Key dates</h2>
        {nextDeadline && daysUntilNext !== null ? (
          <p className="mt-2 text-sm font-medium" style={{ color: accent }}>
            Next deadline: {DEADLINE_LABELS[nextDeadline.deadline_type] ?? nextDeadline.deadline_type} in{' '}
            {daysUntilNext === 0 ? 'less than a day' : `${daysUntilNext} day${daysUntilNext === 1 ? '' : 's'}`}
          </p>
        ) : null}
        {deadlines.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-8 text-center text-sm text-ink/60">Key dates will be announced soon.</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-border-soft bg-surface shadow-card">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink/60">
                  <th className="px-4 py-3 font-medium">Milestone</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
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
                        <td className="px-4 py-3">{DEADLINE_LABELS[d.deadline_type] ?? d.deadline_type}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatKathmandu(closes)}</td>
                        <td className="px-4 py-3">{isPast ? (
                          <span className="inline-flex rounded-full bg-surface-muted/60 px-2.5 py-0.5 text-xs font-medium text-ink/60">Closed</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                            Open
                          </span>
                        )}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="mt-12 bg-footer text-white/70">
        <div className="mx-auto max-w-7xl px-4 py-10 text-sm sm:px-6">
          <p className="font-medium text-white">{conference.name}</p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            {conference.contact_email ? (
              <a href={`mailto:${conference.contact_email}`} className="hover:text-white">
                {conference.contact_email}
              </a>
            ) : null}
            {conference.contact_phone ? <span>{conference.contact_phone}</span> : null}
            {conference.website_url ? (
              <a href={conference.website_url} target="_blank" rel="noopener noreferrer" className="break-all hover:text-white">
                {conference.website_url}
              </a>
            ) : null}
          </div>
          <Link to="/" className="mt-6 inline-block text-white/60 underline-offset-4 hover:text-white hover:underline">
            ← All conferences
          </Link>
        </div>
      </footer>
    </div>
  )
}
