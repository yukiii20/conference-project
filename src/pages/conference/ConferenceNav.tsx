import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { publicImageUrl } from '../../lib/storage'
import { formatDateRange, formatKathmandu, formatKathmanduTime } from '../../lib/datetime'
import { DEADLINE_LABELS, type Conference, type Deadline, type ScheduleRow, type Supporter, type Track } from './types'

export const SECTIONS = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'committees', label: 'Committees' },
  { id: 'speakers', label: 'Speakers' },
  { id: 'supporters', label: 'Supporters' },
  { id: 'programme', label: 'Programme' },
  { id: 'location', label: 'Location' },
  { id: 'key-dates', label: 'Key dates' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

type ConferenceNavProps = {
  conference: Conference
  tracks: Track[]
  supporters: Supporter[]
  schedule: ScheduleRow[]
  deadlines: Deadline[]
  accent: string
  accentText: string
  logoUrl: string | null
  signupHref: string
  activeSection: string
  onNavigate: (id: SectionId) => void
}

function useSupportsHover(): boolean {
  const [supportsHover, setSupportsHover] = useState(true)
  useEffect(() => {
    const mql = window.matchMedia('(hover: hover) and (pointer: fine)')
    setSupportsHover(mql.matches)
    const onChange = () => setSupportsHover(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return supportsHover
}

function PanelLink({ onClick, accent, children }: { onClick: () => void; accent: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 inline-block text-sm font-medium underline-offset-2 hover:underline"
      style={{ color: accent }}
    >
      {children}
    </button>
  )
}

function AboutPanel({ conference, tracks, accent, onJump }: { conference: Conference; tracks: Track[]; accent: string; onJump: () => void }) {
  const lines = (conference.description ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
  return (
    <div>
      {conference.tagline ? <p className="font-medium text-ink">{conference.tagline}</p> : null}
      {lines.length > 0 ? (
        <p className="mt-1 line-clamp-2 text-sm text-ink/70">{lines.join(' ')}</p>
      ) : !conference.tagline ? (
        <p className="text-sm text-ink/60">No description yet.</p>
      ) : null}
      {tracks.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {tracks.slice(0, 6).map((t) => (
            <span key={t.id} className="rounded-full bg-background px-2 py-0.5 text-xs text-ink/70">
              {t.name}
            </span>
          ))}
        </div>
      ) : null}
      <PanelLink onClick={onJump} accent={accent}>
        Read more
      </PanelLink>
    </div>
  )
}

function SupportersPanel({ supporters, accent, onJump }: { supporters: Supporter[]; accent: string; onJump: () => void }) {
  if (supporters.length === 0) {
    return (
      <div>
        <p className="text-sm text-ink/60">Supporters will be announced soon.</p>
        <PanelLink onClick={onJump} accent={accent}>
          See all supporters
        </PanelLink>
      </div>
    )
  }
  const preview = supporters.slice(0, 6)
  const remaining = supporters.length - preview.length
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {preview.map((s) => {
          const url = publicImageUrl(s.logo_path)
          return url ? (
            <img key={s.id} src={url} alt={s.name} className="h-8 max-w-[72px] object-contain" />
          ) : (
            <span key={s.id} className="text-xs text-ink/70">
              {s.name}
            </span>
          )
        })}
      </div>
      {remaining > 0 ? <p className="mt-2 text-xs text-ink/50">and {remaining} more</p> : null}
      <PanelLink onClick={onJump} accent={accent}>
        See all supporters
      </PanelLink>
    </div>
  )
}

function ProgrammePanel({ conference, schedule, accent, onJump }: { conference: Conference; schedule: ScheduleRow[]; accent: string; onJump: () => void }) {
  if (schedule.length === 0) {
    return (
      <div>
        <p className="text-sm text-ink/60">Programme coming soon.</p>
      </div>
    )
  }
  const now = Date.now()
  const upcoming = [...schedule]
    .filter((r) => new Date(r.session_starts_at).getTime() >= now)
    .sort((a, b) => a.session_starts_at.localeCompare(b.session_starts_at))
    .slice(0, 2)
  return (
    <div>
      <p className="text-sm text-ink/70">{formatDateRange(conference.start_date, conference.end_date)}</p>
      <p className="mt-1 text-xs text-ink/50">
        {schedule.length} published session{schedule.length === 1 ? '' : 's'}
      </p>
      {upcoming.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {upcoming.map((r) => (
            <li key={r.session_id} className="text-xs text-ink/70">
              <span className="font-medium text-ink">{formatKathmanduTime(r.session_starts_at)}</span> {r.session_title}
              {r.room_name ? ` · ${r.room_name}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      <PanelLink onClick={onJump} accent={accent}>
        Full programme
      </PanelLink>
    </div>
  )
}

function LocationPanel({ conference, accent }: { conference: Conference; accent: string }) {
  const hasVenue = Boolean(conference.venue_name || conference.address)
  const mapsHref =
    conference.location_map_url ??
    (hasVenue
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [conference.venue_name, conference.address, conference.city, conference.country].filter(Boolean).join(', '),
        )}`
      : null)
  return (
    <div>
      {conference.venue_name ? <p className="font-medium text-ink">{conference.venue_name}</p> : null}
      {conference.address ? <p className="mt-1 text-sm text-ink/70">{conference.address}</p> : null}
      {conference.city || conference.country ? (
        <p className="text-sm text-ink/70">{[conference.city, conference.country].filter(Boolean).join(', ')}</p>
      ) : null}
      {!hasVenue ? <p className="text-sm text-ink/60">Venue details will be announced soon.</p> : null}
      {mapsHref ? (
        <a
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm font-medium"
          style={{ color: accent }}
        >
          Open in Google Maps ↗
        </a>
      ) : null}
    </div>
  )
}

function KeyDatesPanel({ deadlines, accent, onJump }: { deadlines: Deadline[]; accent: string; onJump: () => void }) {
  if (deadlines.length === 0) {
    return (
      <div>
        <p className="text-sm text-ink/60">Key dates will be announced soon.</p>
        <PanelLink onClick={onJump} accent={accent}>
          All key dates
        </PanelLink>
      </div>
    )
  }

  const now = Date.now()
  type Pending = { deadline_type: string; label: string; at: number; phase: 'opens' | 'closes' }
  const pending: Pending[] = []
  for (const d of deadlines) {
    const label = DEADLINE_LABELS[d.deadline_type] ?? d.deadline_type
    if (d.closes_at && new Date(d.closes_at).getTime() >= now) {
      pending.push({ deadline_type: d.deadline_type, label, at: new Date(d.closes_at).getTime(), phase: 'closes' })
    } else if (!d.closes_at && new Date(d.opens_at).getTime() >= now) {
      pending.push({ deadline_type: d.deadline_type, label, at: new Date(d.opens_at).getTime(), phase: 'opens' })
    }
  }
  pending.sort((a, b) => a.at - b.at)
  const [highlighted, ...rest] = pending

  return (
    <div>
      {highlighted ? (
        <p className="text-sm font-medium" style={{ color: accent }}>
          {highlighted.label} {highlighted.phase} in{' '}
          {(() => {
            const days = Math.ceil((highlighted.at - now) / 86400000)
            return days <= 0 ? 'less than a day' : `${days} day${days === 1 ? '' : 's'}`
          })()}
        </p>
      ) : (
        <p className="text-sm text-ink/60">All key dates have passed.</p>
      )}
      {rest.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-ink/70">
          {rest.slice(0, 3).map((d) => (
            <li key={d.deadline_type}>
              {d.label}: {formatKathmandu(new Date(d.at).toISOString(), { dateOnly: true })}
            </li>
          ))}
        </ul>
      ) : null}
      <PanelLink onClick={onJump} accent={accent}>
        All key dates
      </PanelLink>
    </div>
  )
}

function NavItem({
  id,
  label,
  isActive,
  accent,
  onNavigate,
  panel,
  supportsHover,
  openId,
  setOpenId,
  registerTrigger,
}: {
  id: SectionId
  label: string
  isActive: boolean
  accent: string
  onNavigate: (id: SectionId) => void
  panel: ReactNode | null
  supportsHover: boolean
  openId: string | null
  setOpenId: (updater: string | null | ((cur: string | null) => string | null)) => void
  registerTrigger: (id: string, el: HTMLAnchorElement | null) => void
}) {
  const isOpen = openId === id
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [alignRight, setAlignRight] = useState(false)

  useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current)
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  // Keep the panel on-screen: flip to right-aligned if it would overflow the viewport.
  useEffect(() => {
    if (!isOpen) {
      setAlignRight(false)
      return
    }
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) setAlignRight(true)
  }, [isOpen])

  function clearTimers() {
    if (openTimer.current) window.clearTimeout(openTimer.current)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
  }

  function scheduleOpen() {
    clearTimers()
    openTimer.current = window.setTimeout(() => setOpenId(id), 150)
  }

  function scheduleClose() {
    clearTimers()
    closeTimer.current = window.setTimeout(() => setOpenId((cur) => (cur === id ? null : cur)), 200)
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        if (supportsHover && panel) scheduleOpen()
      }}
      onMouseLeave={() => {
        if (supportsHover && panel) scheduleClose()
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpenId((cur) => (cur === id ? null : cur))
        }
      }}
    >
      <a
        ref={(el) => registerTrigger(id, el)}
        href={`#${id}`}
        onClick={(e) => {
          e.preventDefault()
          setOpenId(null)
          onNavigate(id)
        }}
        onFocus={() => {
          // Gated behind supportsHover: on touch devices, tap-focus should
          // never flash a panel open — tapping just scrolls (see onClick).
          if (panel && supportsHover) setOpenId(id)
        }}
        aria-current={isActive ? 'true' : undefined}
        aria-expanded={panel ? isOpen : undefined}
        aria-controls={panel ? `conf-panel-${id}` : undefined}
        style={isActive ? { color: accent } : undefined}
        className={isActive ? 'font-medium' : 'text-ink/70 hover:text-ink'}
      >
        {label}
      </a>
      {panel && isOpen ? (
        <div
          ref={panelRef}
          id={`conf-panel-${id}`}
          role="region"
          aria-label={`${label} preview`}
          className={`conf-panel-enter absolute top-full z-20 mt-2 w-[320px] max-w-[360px] rounded-lg border-t-4 border-line bg-white p-4 shadow-lg ${
            alignRight ? 'right-0' : 'left-0'
          }`}
          style={{ borderTopColor: accent }}
        >
          {panel}
        </div>
      ) : null}
    </div>
  )
}

export const ConferenceNav = forwardRef<HTMLElement, ConferenceNavProps>(function ConferenceNav(
  { conference, tracks, supporters, schedule, deadlines, accent, accentText, logoUrl, signupHref, activeSection, onNavigate },
  ref,
) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const supportsHover = useSupportsHover()
  const triggerRefs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const navElRef = useRef<HTMLElement | null>(null)

  function registerTrigger(id: string, el: HTMLAnchorElement | null) {
    triggerRefs.current[id] = el
  }

  function setNavRef(el: HTMLElement | null) {
    navElRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.MutableRefObject<HTMLElement | null>).current = el
  }

  function jump(id: SectionId) {
    setOpenId(null)
    onNavigate(id)
  }

  // Escape closes any open panel (and the mobile menu) and returns focus to the trigger.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (openId) {
        const id = openId
        setOpenId(null)
        triggerRefs.current[id]?.focus()
      }
      if (mobileOpen) setMobileOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openId, mobileOpen])

  // Click outside closes an open panel (and the mobile menu).
  useEffect(() => {
    if (!openId && !mobileOpen) return
    function onPointerDown(e: MouseEvent) {
      if (navElRef.current && !navElRef.current.contains(e.target as Node)) {
        setOpenId(null)
        setMobileOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [openId, mobileOpen])

  // Scroll closes an open panel.
  useEffect(() => {
    if (!openId) return
    function onScroll() {
      setOpenId(null)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [openId])

  const panels: Partial<Record<SectionId, ReactNode>> = {
    about: <AboutPanel conference={conference} tracks={tracks} accent={accent} onJump={() => jump('about')} />,
    supporters: <SupportersPanel supporters={supporters} accent={accent} onJump={() => jump('supporters')} />,
    programme: <ProgrammePanel conference={conference} schedule={schedule} accent={accent} onJump={() => jump('programme')} />,
    location: <LocationPanel conference={conference} accent={accent} />,
    'key-dates': <KeyDatesPanel deadlines={deadlines} accent={accent} onJump={() => jump('key-dates')} />,
  }

  return (
    <nav ref={setNavRef} className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <a
          href="#home"
          onClick={(e) => {
            e.preventDefault()
            jump('home')
          }}
          className="flex items-center gap-2 font-semibold"
        >
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-9 w-9 shrink-0 object-contain" />
          ) : (
            <span
              style={{ backgroundColor: accent, color: accentText }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md px-0.5 text-center text-[10px] font-bold leading-none"
            >
              {conference.code}
            </span>
          )}
          {conference.name}
        </a>

        <div className="hidden items-center gap-x-4 gap-y-2 text-sm md:flex">
          {SECTIONS.map((s) => (
            <NavItem
              key={s.id}
              id={s.id}
              label={s.label}
              isActive={activeSection === s.id}
              accent={accent}
              onNavigate={onNavigate}
              panel={panels[s.id] ?? null}
              supportsHover={supportsHover}
              openId={openId}
              setOpenId={setOpenId}
              registerTrigger={registerTrigger}
            />
          ))}
          <Link to="/login" className="rounded-md border border-line px-3 py-1.5 hover:bg-background">
            Sign in
          </Link>
          <Link
            to={signupHref}
            style={{ backgroundColor: accent, color: accentText }}
            className="rounded-md px-3 py-1.5 font-medium hover:opacity-90"
          >
            Register
          </Link>
        </div>

        <div className="relative md:hidden">
          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="conf-mobile-menu"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md p-2 hover:bg-background"
          >
            {mobileOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>

          {mobileOpen ? (
            <div
              id="conf-mobile-menu"
              className="conf-panel-enter absolute top-full right-0 z-20 mt-2 w-screen max-w-xs rounded-lg border border-line bg-white p-2 shadow-lg"
            >
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  aria-current={activeSection === s.id ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    setMobileOpen(false)
                    onNavigate(s.id)
                  }}
                  style={activeSection === s.id ? { color: accent } : undefined}
                  className={`block rounded-md px-3 py-3 text-base ${
                    activeSection === s.id ? 'font-medium' : 'text-ink/80 hover:bg-background'
                  }`}
                >
                  {s.label}
                </a>
              ))}
              <div className="mt-2 flex gap-2 border-t border-line pt-3">
                <Link
                  to="/login"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 rounded-md border border-line px-3 py-2 text-center text-sm"
                >
                  Sign in
                </Link>
                <Link
                  to={signupHref}
                  onClick={() => setMobileOpen(false)}
                  style={{ backgroundColor: accent, color: accentText }}
                  className="flex-1 rounded-md px-3 py-2 text-center text-sm font-medium"
                >
                  Register
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  )
})
