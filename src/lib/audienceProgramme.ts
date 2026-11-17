import { kathmanduDateKey } from './datetime'

export type DeliveryMode = 'in_person' | 'online' | 'hybrid'

export type AudienceSession = {
  id: string
  title: string
  session_type: string
  description: string | null
  starts_at: string
  ends_at: string
  status: string
  delivery_mode: DeliveryMode
  room: { id: string; name: string } | null
  track: { id: string; name: string } | null
  chairs: Array<{ full_name: string }>
  presentations: Array<{ id: string; title: string; authors: string[] | null; speaker_name: string | null }>
  starred: boolean
  attended: boolean
  online_window: { opens_at: string; closes_at: string; open: boolean } | null
  /** Set when the organisers changed time/room/title/mode or cancelled it (Phase 6). */
  schedule_change?: { summary: string; changed_at: string } | null
}

export type ProgrammeFilters = {
  day: string
  trackId: string
  roomId: string
  query: string
  onlyStarred: boolean
}

export const EMPTY_FILTERS: ProgrammeFilters = { day: '', trackId: '', roomId: '', query: '', onlyStarred: false }

/** Distinct conference days ("YYYY-MM-DD", Kathmandu time) in programme order. */
export function programmeDays(sessions: AudienceSession[]): string[] {
  return [...new Set(sessions.map((s) => kathmanduDateKey(s.starts_at)))].sort()
}

/** Day, track, room, "My agenda" and a search over the title, speakers, authors and chairs. */
export function filterSessions(sessions: AudienceSession[], f: ProgrammeFilters): AudienceSession[] {
  const q = f.query.trim().toLowerCase()
  return sessions.filter((s) => {
    if (f.day && kathmanduDateKey(s.starts_at) !== f.day) return false
    if (f.trackId && s.track?.id !== f.trackId) return false
    if (f.roomId && s.room?.id !== f.roomId) return false
    if (f.onlyStarred && !s.starred) return false
    if (!q) return true
    const haystack = [
      s.title,
      ...s.chairs.map((c) => c.full_name),
      ...s.presentations.flatMap((p) => [p.title, p.speaker_name ?? '', ...(p.authors ?? [])]),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}

/**
 * What the "Join online" control should say right now. The server re-checks everything
 * (registration, window, mode) - this is only the label.
 */
export function joinState(s: AudienceSession, now = new Date()): 'none' | 'soon' | 'open' | 'ended' {
  if (!s.online_window || s.status === 'cancelled') return 'none'
  if (now < new Date(s.online_window.opens_at)) return 'soon'
  if (now > new Date(s.online_window.closes_at)) return 'ended'
  return 'open'
}

/** The session whose Q&A is most likely wanted now: one in progress, else the next, else the last. */
export function pickDefaultSession(sessions: AudienceSession[], now = Date.now()): string {
  const live = sessions.filter((s) => s.status !== 'cancelled')
  const current = live.find((s) => new Date(s.starts_at).getTime() <= now && new Date(s.ends_at).getTime() >= now)
  const next = live.find((s) => new Date(s.starts_at).getTime() > now)
  return (current ?? next ?? live[live.length - 1])?.id ?? ''
}
