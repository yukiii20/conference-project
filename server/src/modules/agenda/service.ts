import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { env } from '../../config/env.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { generateToken } from '../../utils/crypto.js'
import { NotFoundError } from '../../utils/errors.js'
import { getPublicSchedule, type PublicSessionRow } from '../schedule/service.js'
import { generateIcs, type IcsEvent } from './ics.js'

/** How often a subscribed calendar app is asked to re-fetch the private feed. */
const FEED_REFRESH_MINUTES = 60

export type AgendaReason = 'starred' | 'chair' | 'presenting'

export type AgendaEntry = PublicSessionRow & {
  reasons: AgendaReason[]
  /** Ids of other agenda sessions that overlap this one in time. */
  clashes_with: string[]
}

export type AgendaConference = {
  id: string
  name: string
  slug: string
  timezone: string
  venue_name: string | null
  address: string | null
  city: string | null
  location_map_url: string | null
}

async function loadConference(conferenceId: string): Promise<AgendaConference> {
  const [rows] = await pool.query(
    `SELECT id, name, slug, timezone, venue_name, address, city, location_map_url
     FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [conferenceId],
  )
  const conference = (rows as AgendaConference[])[0]
  if (!conference) throw new NotFoundError('This conference does not exist.')
  return conference
}

/** Every conference this person has an agenda reason in: registered, a member in any role, chairing, presenting/authoring, or with a starred session. */
export async function listAgendaConferences(userId: string): Promise<Array<{ id: string; name: string; slug: string }>> {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.slug FROM conferences c
     WHERE c.deleted_at IS NULL AND (
       EXISTS (SELECT 1 FROM registrations r WHERE r.conference_id = c.id AND r.user_id = ? AND r.status <> 'cancelled')
       OR EXISTS (SELECT 1 FROM conference_members m WHERE m.conference_id = c.id AND m.user_id = ? AND m.status = 'active')
       OR EXISTS (SELECT 1 FROM agenda_items a WHERE a.conference_id = c.id AND a.user_id = ?)
     )
     ORDER BY c.start_date DESC`,
    [userId, userId, userId],
  )
  return rows as Array<{ id: string; name: string; slug: string }>
}

/** Session ids this person is added to automatically: sessions they chair, and sessions holding a presentation they present or co-authored. */
async function automaticSessionIds(conferenceId: string, userId: string): Promise<{ chair: Set<string>; presenting: Set<string> }> {
  const [chairRows] = await pool.query(
    `SELECT c.session_id FROM session_chairs c JOIN conference_sessions s ON s.id = c.session_id
     WHERE c.user_id = ? AND s.conference_id = ?`,
    [userId, conferenceId],
  )
  const [presentingRows] = await pool.query(
    `SELECT DISTINCT p.session_id FROM presentations p
     LEFT JOIN submission_authors sa ON sa.submission_id = p.submission_id AND sa.user_id = ?
     WHERE p.conference_id = ? AND p.status <> 'cancelled'
       AND (p.presenter_user_id = ? OR sa.id IS NOT NULL)`,
    [userId, conferenceId, userId],
  )
  return {
    chair: new Set((chairRows as Array<{ session_id: string }>).map((r) => r.session_id)),
    presenting: new Set((presentingRows as Array<{ session_id: string }>).map((r) => r.session_id)),
  }
}

async function starredSessionIds(conferenceId: string, userId: string): Promise<Set<string>> {
  const [rows] = await pool.query('SELECT session_id FROM agenda_items WHERE conference_id = ? AND user_id = ?', [
    conferenceId,
    userId,
  ])
  return new Set((rows as Array<{ session_id: string }>).map((r) => r.session_id))
}

/** Pairs of agenda sessions whose time ranges overlap (touching end-to-start is not a clash). */
export function findClashes(sessions: Array<{ id: string; starts_at: string | Date; ends_at: string | Date }>): Map<string, string[]> {
  const clashes = new Map<string, string[]>()
  const sorted = [...sessions].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!
    const aEnd = new Date(a.ends_at).getTime()
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!
      if (new Date(b.starts_at).getTime() >= aEnd) break
      clashes.set(a.id, [...(clashes.get(a.id) ?? []), b.id])
      clashes.set(b.id, [...(clashes.get(b.id) ?? []), a.id])
    }
  }
  return clashes
}

/** "My agenda": starred + automatic sessions from the published programme, in time order, each with why it's there and what it clashes with. */
export async function getMyAgenda(
  conferenceId: string,
  userId: string,
): Promise<{ conference: AgendaConference; sessions: AgendaEntry[]; starred_ids: string[] }> {
  const conference = await loadConference(conferenceId)
  const [schedule, starred, automatic] = await Promise.all([
    getPublicSchedule(conferenceId),
    starredSessionIds(conferenceId, userId),
    automaticSessionIds(conferenceId, userId),
  ])
  const picked = schedule.filter((s) => starred.has(s.id) || automatic.chair.has(s.id) || automatic.presenting.has(s.id))
  const clashes = findClashes(picked)
  const sessions = picked.map((s) => {
    const reasons: AgendaReason[] = []
    if (automatic.presenting.has(s.id)) reasons.push('presenting')
    if (automatic.chair.has(s.id)) reasons.push('chair')
    if (starred.has(s.id)) reasons.push('starred')
    return { ...s, reasons, clashes_with: clashes.get(s.id) ?? [] }
  })
  return { conference, sessions, starred_ids: [...starred] }
}

/** Only sessions visible on the public programme can be starred. */
async function assertPublishedSession(conferenceId: string, sessionId: string): Promise<void> {
  const [rows] = await pool.query(
    `SELECT 1 FROM conference_sessions WHERE id = ? AND conference_id = ? AND status = 'published' LIMIT 1`,
    [sessionId, conferenceId],
  )
  if ((rows as unknown[]).length === 0) throw new NotFoundError('This session does not exist.')
}

export async function starSession(conferenceId: string, userId: string, sessionId: string): Promise<void> {
  await assertPublishedSession(conferenceId, sessionId)
  await pool.query('INSERT IGNORE INTO agenda_items (conference_id, user_id, session_id) VALUES (?, ?, ?)', [
    conferenceId,
    userId,
    sessionId,
  ])
}

export async function unstarSession(conferenceId: string, userId: string, sessionId: string): Promise<void> {
  await pool.query('DELETE FROM agenda_items WHERE conference_id = ? AND user_id = ? AND session_id = ?', [
    conferenceId,
    userId,
    sessionId,
  ])
}

function sessionLocation(session: PublicSessionRow, conference: AgendaConference): string {
  const room = session.room
    ? [session.room.name, session.room.room_number ? `Room ${session.room.room_number}` : null, session.room.building]
        .filter(Boolean)
        .join(', ')
    : ''
  return [room, conference.venue_name].filter(Boolean).join(' - ')
}

function sessionToEvent(session: PublicSessionRow, conference: AgendaConference): IcsEvent {
  const lines: string[] = []
  if (session.description) lines.push(session.description)
  if (session.chairs.length > 0) lines.push(`Chair: ${session.chairs.map((c) => c.full_name).join(', ')}`)
  for (const p of session.presentations) {
    const who = p.authors && p.authors.length > 0 ? p.authors.join(', ') : p.speaker_name ?? ''
    lines.push(`- ${p.title}${who ? ` (${who})` : ''}`)
  }
  return {
    uid: `${session.id}@conference-management-system`,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    summary: `${conference.name}: ${session.title}`,
    location: sessionLocation(session, conference),
    description: lines.join('\n') || null,
    url: `${env.APP_URL}/c/${conference.slug}#programme`,
  }
}

/** A one-event calendar for a single published session - the programme's per-session "Add to calendar". */
export async function sessionIcs(conferenceId: string, sessionId: string): Promise<string> {
  const conference = await loadConference(conferenceId)
  const session = (await getPublicSchedule(conferenceId)).find((s) => s.id === sessionId)
  if (!session) throw new NotFoundError('This session does not exist.')
  return generateIcs({ name: conference.name, timezone: conference.timezone, events: [sessionToEvent(session, conference)] })
}

export async function myAgendaIcs(conferenceId: string, userId: string, opts: { feed?: boolean } = {}): Promise<string> {
  const { conference, sessions } = await getMyAgenda(conferenceId, userId)
  return generateIcs({
    name: `${conference.name} - My agenda`,
    timezone: conference.timezone,
    events: sessions.map((s) => sessionToEvent(s, conference)),
    refreshMinutes: opts.feed ? FEED_REFRESH_MINUTES : undefined,
  })
}

function feedUrl(token: string): string {
  return `${env.APP_URL}/api/calendar/${token}.ics`
}

/** The private calendar-feed URL, creating its token on first use. */
export async function getFeedUrl(conferenceId: string, userId: string): Promise<{ url: string }> {
  await loadConference(conferenceId)
  await pool.query('INSERT IGNORE INTO agenda_feed_tokens (conference_id, user_id, token) VALUES (?, ?, ?)', [
    conferenceId,
    userId,
    generateToken(),
  ])
  const [rows] = await pool.query('SELECT token FROM agenda_feed_tokens WHERE conference_id = ? AND user_id = ? LIMIT 1', [
    conferenceId,
    userId,
  ])
  return { url: feedUrl((rows as Array<{ token: string }>)[0]!.token) }
}

/** Replaces the feed token, so the previous URL stops working immediately. */
export async function resetFeedToken(conferenceId: string, userId: string, audit: AuditContext = {}): Promise<{ url: string }> {
  await loadConference(conferenceId)
  const token = generateToken()
  await withTransaction(userId, async (conn) => {
    await conn.query(
      `INSERT INTO agenda_feed_tokens (conference_id, user_id, token) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE token = VALUES(token)`,
      [conferenceId, userId, token],
    )
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: 'agenda.feed_reset',
      entityType: 'agenda_feed_tokens',
      entityId: userId,
      ...audit,
    })
  })
  return { url: feedUrl(token) }
}

/** Public feed lookup by secret token - a wrong/old token is simply "not found". */
export async function feedIcsByToken(token: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new NotFoundError('This calendar link is not valid.')
  const [rows] = await pool.query('SELECT conference_id, user_id FROM agenda_feed_tokens WHERE token = ? LIMIT 1', [token])
  const row = (rows as Array<{ conference_id: string; user_id: string }>)[0]
  if (!row) throw new NotFoundError('This calendar link is not valid.')
  return myAgendaIcs(row.conference_id, row.user_id, { feed: true })
}
