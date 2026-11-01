// Shared types and pure helpers for the public home page.

export type Conference = {
  id: string
  slug: string
  code: string
  name: string
  short_name: string | null
  tagline: string | null
  theme: string | null
  city: string | null
  country: string | null
  venue_name: string | null
  start_date: string
  end_date: string
  status: string
  logo_path: string | null
  banner_path: string | null
  primary_color: string | null
}

export type Announcement = {
  id: string
  title: string
  body: string
  publish_at: string | null
  created_at: string
  conference_name: string
  conference_slug: string
}

export type DeadlineWindow = { opens_at: string; closes_at: string | null }

export type PublicStats = { conferences: number; submissions: number; registrations: number; countries: number }

export type TabId = 'all' | 'open' | 'upcoming' | 'past'

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submission_open: 'Abstracts open',
  registration_open: 'Registration open',
  published: 'Programme published',
  ongoing: 'Happening now',
  completed: 'Past conference',
  closed: 'Past conference',
  under_review: 'Under review',
  scheduling: 'Scheduling',
}

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null

export function countryName(code: string | null): string | null {
  if (!code) return null
  try {
    return regionNames?.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

export function placeLabel(c: Pick<Conference, 'city' | 'country'>): string | null {
  return [c.city, countryName(c.country)].filter(Boolean).join(', ') || null
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  return (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase()
}

export function todayDateString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export type WindowState = 'open' | 'upcoming' | 'closed' | 'none'

/** Where `now` sits in a deadline window. */
export function windowState(w: DeadlineWindow | undefined, now = Date.now()): WindowState {
  if (!w) return 'none'
  const opens = new Date(w.opens_at).getTime()
  const closes = w.closes_at ? new Date(w.closes_at).getTime() : null
  if (now < opens) return 'upcoming'
  if (closes !== null && now > closes) return 'closed'
  return 'open'
}

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kathmandu' })
const LONG_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' })

export function shortDate(iso: string): string {
  return SHORT_DATE.format(new Date(iso))
}

export function longDate(iso: string): string {
  return LONG_DATE.format(new Date(iso))
}

/** Whole days from now until `iso` (0 = today/past). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000))
}

/** "YYYY-MM-DD" → { day: '12', month: 'Nov' } for calendar-style date tiles. */
export function dateTile(date: string): { day: string; month: string } {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  return { day: String(d), month: dt.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }) }
}

/** Respect reduced motion when scrolling programmatically. */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}
