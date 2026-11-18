import type { PoolConnection } from 'mysql2/promise'
import { env } from '../../config/env.js'
import { pool } from '../../db/pool.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'

/** Changes made within this window go out in one summary email per person. */
export const SCHEDULE_EMAIL_BATCH_MINUTES = 15

export type ScheduleChangeKind = 'time' | 'room' | 'title' | 'mode' | 'cancelled' | 'reinstated'

type SessionSnapshot = {
  title: string
  room_id: string | null
  starts_at: string | Date
  ends_at: string | Date
  status: string
  delivery_mode: string
}

const MODE_LABEL: Record<string, string> = { in_person: 'in person', online: 'online', hybrid: 'in person and online' }

function ms(v: string | Date): number {
  return new Date(v).getTime()
}

/** What changed that the Audience cares about. Drafts never matter: the Audience never saw them. */
export function detectScheduleChanges(before: SessionSnapshot, after: SessionSnapshot): ScheduleChangeKind[] {
  if (before.status !== 'published' && !(before.status === 'cancelled' && after.status === 'published')) return []
  if (before.status === 'published' && after.status === 'cancelled') return ['cancelled']
  if (before.status === 'published' && after.status === 'draft') return ['cancelled']
  const kinds: ScheduleChangeKind[] = []
  if (before.status === 'cancelled' && after.status === 'published') kinds.push('reinstated')
  if (ms(before.starts_at) !== ms(after.starts_at) || ms(before.ends_at) !== ms(after.ends_at)) kinds.push('time')
  if ((before.room_id ?? null) !== (after.room_id ?? null)) kinds.push('room')
  if (before.title !== after.title) kinds.push('title')
  if (before.delivery_mode !== after.delivery_mode) kinds.push('mode')
  return kinds
}

function formatInZone(value: string | Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
      new Date(value),
    )
  } catch {
    return new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  }
}

function formatTimeInZone(value: string | Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  } catch {
    return new Date(value).toISOString().slice(11, 16)
  }
}

/** One plain sentence, e.g. "Water panel: moved to Tue 19 Nov, 10:00-11:00; now in Hall B." */
export function describeScheduleChange(
  kinds: ScheduleChangeKind[],
  before: SessionSnapshot,
  after: SessionSnapshot,
  roomName: string | null,
  timeZone: string,
): string {
  const parts: string[] = []
  for (const kind of kinds) {
    if (kind === 'cancelled') parts.push('cancelled')
    if (kind === 'reinstated') parts.push('back on the programme')
    if (kind === 'time') parts.push(`moved to ${formatInZone(after.starts_at, timeZone)}-${formatTimeInZone(after.ends_at, timeZone)}`)
    if (kind === 'room') parts.push(roomName ? `now in ${roomName}` : 'room changed')
    if (kind === 'title') parts.push(`renamed from "${before.title}"`)
    if (kind === 'mode') parts.push(`now ${MODE_LABEL[after.delivery_mode] ?? after.delivery_mode}`)
  }
  return `${after.title}: ${parts.join('; ')}.`.slice(0, 500)
}

/** Registered Audience = active Audience membership plus a confirmed registration, in this conference. */
const AUDIENCE_RECIPIENTS_SQL = `
  SELECT DISTINCT u.id AS user_id, u.full_name, u.email
  FROM registrations r
  JOIN users u ON u.id = r.user_id
  JOIN conference_members cm ON cm.conference_id = r.conference_id AND cm.user_id = r.user_id
       AND cm.role_code = 'attendee' AND cm.status = 'active'
  WHERE r.conference_id = ? AND r.status = 'confirmed'`

/**
 * Called inside the session-update transaction. Records the change (it drives the "Schedule
 * changed" note) and puts one portal notification in front of every registered Audience member
 * straight away. The email - if the conference has them on - waits for the batch job.
 */
export async function recordScheduleChange(
  conn: PoolConnection,
  conferenceId: string,
  sessionId: string,
  actorUserId: string,
  before: SessionSnapshot,
  after: SessionSnapshot,
): Promise<void> {
  const kinds = detectScheduleChanges(before, after)
  if (kinds.length === 0) return
  const [confRows] = await conn.query('SELECT timezone FROM conferences WHERE id = ? LIMIT 1', [conferenceId])
  const timeZone = (confRows as Array<{ timezone: string }>)[0]?.timezone ?? 'Asia/Kathmandu'
  let roomName: string | null = null
  if (kinds.includes('room') && after.room_id) {
    const [roomRows] = await conn.query('SELECT name FROM rooms WHERE id = ? LIMIT 1', [after.room_id])
    roomName = (roomRows as Array<{ name: string }>)[0]?.name ?? null
  }
  const summary = describeScheduleChange(kinds, before, after, roomName, timeZone)
  await conn.query(
    `INSERT INTO schedule_changes (conference_id, session_id, change_kinds, summary, changed_by) VALUES (?, ?, ?, ?, ?)`,
    [conferenceId, sessionId, JSON.stringify(kinds), summary, actorUserId],
  )
  const title = kinds.includes('cancelled') ? 'Session cancelled' : 'Schedule changed'
  await conn.query(
    `INSERT INTO notifications (user_id, conference_id, type, title, body, link_path, entity_type, entity_id)
     SELECT a.user_id, ?, 'schedule', ?, ?, '/portal/programme', 'conference_sessions', ?
     FROM (${AUDIENCE_RECIPIENTS_SQL}) a`,
    [conferenceId, title, summary, sessionId, conferenceId],
  )
}

/**
 * A published session was deleted outright (not cancelled). Its schedule_changes rows go with it
 * (ON DELETE CASCADE), so the batched email cannot carry it: the registered Audience get the
 * portal notice straight away instead. Drafts were never visible, so they notify nobody.
 */
export async function notifyAudienceSessionRemoved(
  conn: PoolConnection,
  conferenceId: string,
  sessionId: string,
  before: { title: string; status: string },
): Promise<void> {
  if (before.status !== 'published') return
  const summary = `${before.title}: removed from the programme.`.slice(0, 500)
  await conn.query(
    `INSERT INTO notifications (user_id, conference_id, type, title, body, link_path, entity_type, entity_id)
     SELECT a.user_id, ?, 'schedule', 'Session cancelled', ?, '/portal/programme', 'conference_sessions', ?
     FROM (${AUDIENCE_RECIPIENTS_SQL}) a`,
    [conferenceId, summary, sessionId, conferenceId],
  )
}

/** Latest change per session (for the "Schedule changed" note on the Audience programme). */
export async function latestScheduleChanges(conferenceId: string): Promise<Map<string, { at: string; summary: string; kinds: ScheduleChangeKind[] }>> {
  const [rows] = await pool.query(
    `SELECT sc.session_id, sc.created_at, sc.summary, sc.change_kinds
     FROM schedule_changes sc
     JOIN (SELECT session_id, MAX(id) AS id FROM schedule_changes WHERE conference_id = ? GROUP BY session_id) last ON last.id = sc.id`,
    [conferenceId],
  )
  const out = new Map<string, { at: string; summary: string; kinds: ScheduleChangeKind[] }>()
  for (const r of rows as Array<{ session_id: string; created_at: Date; summary: string; change_kinds: unknown }>) {
    const kinds = typeof r.change_kinds === 'string' ? JSON.parse(r.change_kinds) : r.change_kinds
    out.set(r.session_id, { at: new Date(r.created_at).toISOString(), summary: r.summary, kinds: kinds as ScheduleChangeKind[] })
  }
  return out
}

/**
 * Batch job (tick + timer): for each conference whose oldest un-emailed change is at least 15
 * minutes old, sends ONE summary email per registered Audience member listing every pending
 * change, then marks them emailed. When the conference turned schedule-change emails off, the
 * changes are only marked (they still show in the portal). Safe to run twice at once: the
 * pending rows are locked, and a second run finds nothing left.
 */
export async function sendScheduleChangeEmails(): Promise<{ conferences: number; emails: number }> {
  const [due] = await pool.query(
    `SELECT conference_id FROM schedule_changes WHERE emailed_at IS NULL
     GROUP BY conference_id HAVING MIN(created_at) <= NOW(3) - INTERVAL ${SCHEDULE_EMAIL_BATCH_MINUTES} MINUTE`,
  )
  let emails = 0
  const conferenceIds = (due as Array<{ conference_id: string }>).map((r) => r.conference_id)
  for (const conferenceId of conferenceIds) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [pending] = await conn.query(
        `SELECT id, summary FROM schedule_changes WHERE conference_id = ? AND emailed_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED`,
        [conferenceId],
      )
      const changes = pending as Array<{ id: number; summary: string }>
      if (changes.length === 0) {
        await conn.rollback()
        continue
      }
      const [confRows] = await conn.query(
        `SELECT c.code, c.name, c.slug, COALESCE(cs.schedule_change_emails, TRUE) AS emails_on
         FROM conferences c LEFT JOIN conference_settings cs ON cs.conference_id = c.id WHERE c.id = ? LIMIT 1`,
        [conferenceId],
      )
      const conference = (confRows as Array<{ code: string; name: string; slug: string; emails_on: number }>)[0]
      if (conference && Boolean(conference.emails_on)) {
        const [recipients] = await conn.query(AUDIENCE_RECIPIENTS_SQL, [conferenceId])
        const [templateRows] = await conn.query(
          `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'audience_schedule_changed' LIMIT 1`,
        )
        const subjectTemplate = (templateRows as Array<{ subject: string }>)[0]?.subject ?? '[{{conference_code}}] Programme changes'
        const changesText = changes.map((c) => `• ${c.summary}`).join('\n')
        for (const r of recipients as Array<{ user_id: string; full_name: string; email: string }>) {
          const data = {
            full_name: r.full_name,
            conference_code: conference.code,
            conference_name: conference.name,
            changes: changesText,
            programme_url: `${env.APP_URL}/portal/programme`,
          }
          await queueEmail(conn, {
            userId: r.user_id,
            conferenceId,
            recipientEmail: r.email,
            templateKey: 'audience_schedule_changed',
            subject: renderTemplate(subjectTemplate, data),
            templateData: data,
            entityType: 'schedule_changes',
            entityId: String(changes[changes.length - 1]!.id),
          })
          emails += 1
        }
      }
      await conn.query(`UPDATE schedule_changes SET emailed_at = NOW(3) WHERE id IN (?)`, [changes.map((c) => c.id)])
      await conn.commit()
    } catch (err) {
      await conn.rollback().catch(() => undefined)
      throw err
    } finally {
      conn.release()
    }
  }
  return { conferences: conferenceIds.length, emails }
}
