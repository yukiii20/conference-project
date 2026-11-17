import { pool } from '../../db/pool.js'
import { ForbiddenError, NotFoundError } from '../../utils/errors.js'
import { getAudienceSchedule, type PublicSessionRow } from '../schedule/service.js'
import { assertConfirmedRegistration, getConfirmedRegistration } from './access.js'

/** The private online link opens this long before a session starts, and closes when it ends. */
export const ONLINE_LINK_OPENS_MINUTES_BEFORE = 15

export type OnlineWindow = { opens_at: string; closes_at: string; open: boolean }

export function onlineWindow(startsAt: string | Date, endsAt: string | Date, now = new Date()): OnlineWindow {
  const opens = new Date(new Date(startsAt).getTime() - ONLINE_LINK_OPENS_MINUTES_BEFORE * 60_000)
  const closes = new Date(endsAt)
  return { opens_at: opens.toISOString(), closes_at: closes.toISOString(), open: now >= opens && now <= closes }
}

export type AudienceSession = PublicSessionRow & {
  starred: boolean
  /** Only for online/hybrid sessions: when "Join online" works (it never carries the link). */
  online_window: OnlineWindow | null
  attended: boolean
}

/**
 * The programme as the Audience sees it: published sessions plus cancelled ones (so a cancelled
 * session shows as cancelled instead of silently vanishing), never drafts, never the private
 * online link. Filtering (day/track/room/search) happens on the phone - one request, small list.
 */
export async function getAudienceProgramme(
  conferenceId: string,
  userId: string,
): Promise<{
  timezone: string
  registered: boolean
  sessions: AudienceSession[]
  tracks: Array<{ id: string; name: string }>
  rooms: Array<{ id: string; name: string }>
}> {
  const [confRows] = await pool.query('SELECT timezone FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [conferenceId])
  const conference = (confRows as Array<{ timezone: string }>)[0]
  if (!conference) throw new NotFoundError('This conference does not exist.')

  const [sessions, registration, [starRows], [attendRows]] = await Promise.all([
    getAudienceSchedule(conferenceId),
    getConfirmedRegistration(conferenceId, userId),
    pool.query('SELECT session_id FROM agenda_items WHERE conference_id = ? AND user_id = ?', [conferenceId, userId]),
    pool.query('SELECT session_id FROM session_attendance WHERE conference_id = ? AND user_id = ?', [conferenceId, userId]),
  ])
  const starred = new Set((starRows as Array<{ session_id: string }>).map((r) => r.session_id))
  const attended = new Set((attendRows as Array<{ session_id: string }>).map((r) => r.session_id))

  const tracks = new Map<string, string>()
  const rooms = new Map<string, string>()
  for (const s of sessions) {
    if (s.track) tracks.set(s.track.id, s.track.name)
    if (s.room) rooms.set(s.room.id, s.room.name)
  }

  return {
    timezone: conference.timezone,
    registered: Boolean(registration),
    sessions: sessions.map((s) => ({
      ...s,
      starred: starred.has(s.id),
      attended: attended.has(s.id),
      online_window: s.delivery_mode === 'in_person' || s.status === 'cancelled' ? null : onlineWindow(s.starts_at, s.ends_at),
    })),
    tracks: [...tracks].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    rooms: [...rooms].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

type OnlineSessionRow = {
  id: string
  title: string
  status: string
  delivery_mode: 'in_person' | 'online' | 'hybrid'
  online_url: string | null
  online_instructions: string | null
  starts_at: string
  ends_at: string
}

function formatUtc(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

/**
 * "Join online": hands out the private link only to a registered (confirmed) Audience member,
 * only for a published online/hybrid session, only from 15 minutes before the start until the
 * end - and records online attendance (counts towards the certificate). A person already
 * scanned in at the door keeps their QR record.
 */
export async function joinOnline(
  conferenceId: string,
  sessionId: string,
  userId: string,
  now = new Date(),
): Promise<{ online_url: string; online_instructions: string | null; recorded: boolean }> {
  const registration = await assertConfirmedRegistration(conferenceId, userId)
  const [rows] = await pool.query(
    `SELECT id, title, status, delivery_mode, online_url, online_instructions, starts_at, ends_at
     FROM conference_sessions WHERE id = ? AND conference_id = ? LIMIT 1`,
    [sessionId, conferenceId],
  )
  const session = (rows as OnlineSessionRow[])[0]
  if (!session || session.status === 'draft') throw new NotFoundError('This session does not exist.')
  if (session.status === 'cancelled') throw new ForbiddenError('This session has been cancelled.')
  if (session.delivery_mode === 'in_person' || !session.online_url) {
    throw new ForbiddenError('This session is in person only - there is no online link.')
  }
  const window = onlineWindow(session.starts_at, session.ends_at, now)
  if (!window.open) {
    throw new ForbiddenError(
      now < new Date(window.opens_at)
        ? `The online link opens 15 minutes before the session starts (${formatUtc(window.opens_at)}).`
        : 'This session has ended, so the online link is closed.',
    )
  }

  const [result] = await pool.query(
    `INSERT IGNORE INTO session_attendance (conference_id, session_id, user_id, registration_id, method, recorded_by)
     VALUES (?, ?, ?, ?, 'online', ?)`,
    [conferenceId, sessionId, userId, registration.id, userId],
  )
  return {
    online_url: session.online_url,
    online_instructions: session.online_instructions,
    recorded: (result as { affectedRows: number }).affectedRows > 0,
  }
}

export type AudienceSpeaker = {
  id: string
  full_name: string
  designation: string | null
  affiliation: string | null
  bio: string | null
  research_topics: string | null
  photo_path: string | null
  speaker_type: string
  sessions: Array<{ id: string; title: string; starts_at: string; ends_at: string; status: string }>
}

/** Public speakers (is_public) with their published/cancelled sessions. */
export async function getAudienceSpeakers(conferenceId: string): Promise<AudienceSpeaker[]> {
  const [speakerRows] = await pool.query(
    `SELECT id, full_name, designation, affiliation, bio, research_topics, photo_path, speaker_type
     FROM conference_speakers WHERE conference_id = ? AND is_public = TRUE ORDER BY display_order, full_name`,
    [conferenceId],
  )
  const speakers = speakerRows as Array<Omit<AudienceSpeaker, 'sessions'>>
  if (speakers.length === 0) return []
  const [sessionRows] = await pool.query(
    `SELECT DISTINCT p.speaker_id, s.id, s.title, s.starts_at, s.ends_at, s.status
     FROM presentations p JOIN conference_sessions s ON s.id = p.session_id
     WHERE p.conference_id = ? AND p.speaker_id IN (?) AND p.status <> 'cancelled' AND s.status IN ('published', 'cancelled')
     ORDER BY s.starts_at`,
    [conferenceId, speakers.map((s) => s.id)],
  )
  const bySpeaker = new Map<string, AudienceSpeaker['sessions']>()
  for (const row of sessionRows as Array<{ speaker_id: string } & AudienceSpeaker['sessions'][number]>) {
    const list = bySpeaker.get(row.speaker_id) ?? []
    list.push({ id: row.id, title: row.title, starts_at: row.starts_at, ends_at: row.ends_at, status: row.status })
    bySpeaker.set(row.speaker_id, list)
  }
  return speakers.map((s) => ({ ...s, sessions: bySpeaker.get(s.id) ?? [] }))
}
