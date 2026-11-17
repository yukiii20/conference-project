import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { ForbiddenError } from '../../utils/errors.js'

/**
 * Shared rules for the Audience role ('attendee').
 *
 * The route guard (requireConferencePermission('audience.*')) proves the person holds the
 * Audience role IN THIS conference (and the session is bound to it). Most Audience features
 * additionally need a CONFIRMED registration here - the same rule the check-in desk uses - so
 * an unpaid or cancelled registration never opens online links, Q&A, ratings or downloads.
 */
export const AUDIENCE_ROLE = 'attendee'

export const NOT_REGISTERED_MESSAGE =
  'You need a confirmed registration for this conference to do this. Open "My ticket" to register or check your payment.'

export type ConfirmedRegistration = { id: string; registration_number: string }

export async function getConfirmedRegistration(
  conferenceId: string,
  userId: string,
  conn: PoolConnection | typeof pool = pool,
): Promise<ConfirmedRegistration | null> {
  const [rows] = await conn.query(
    `SELECT id, registration_number FROM registrations
     WHERE conference_id = ? AND user_id = ? AND status = 'confirmed' LIMIT 1`,
    [conferenceId, userId],
  )
  return (rows as ConfirmedRegistration[])[0] ?? null
}

/** Throws 403 unless the person has a confirmed registration for this conference. */
export async function assertConfirmedRegistration(
  conferenceId: string,
  userId: string,
  conn: PoolConnection | typeof pool = pool,
): Promise<ConfirmedRegistration> {
  const registration = await getConfirmedRegistration(conferenceId, userId, conn)
  if (!registration) throw new ForbiddenError(NOT_REGISTERED_MESSAGE)
  return registration
}

/** Session statuses the Audience may ever see (never drafts). */
export const AUDIENCE_SESSION_STATUSES = ['published', 'ongoing', 'completed', 'cancelled'] as const

export type AudienceSettings = {
  qa_minutes_after_end: number
  audience_feedback_closes_at: Date | null
  schedule_change_emails: boolean
  audience_abstracts_enabled: boolean
  public_abstracts_enabled: boolean
}

export const DEFAULT_AUDIENCE_SETTINGS: AudienceSettings = {
  qa_minutes_after_end: 30,
  audience_feedback_closes_at: null,
  schedule_change_emails: true,
  audience_abstracts_enabled: true,
  public_abstracts_enabled: false,
}

/** The Audience settings of one conference (defaults when the conference has no settings row yet). */
export async function getAudienceSettings(
  conferenceId: string,
  conn: PoolConnection | typeof pool = pool,
): Promise<AudienceSettings> {
  const [rows] = await conn.query(
    `SELECT qa_minutes_after_end, audience_feedback_closes_at, schedule_change_emails,
            audience_abstracts_enabled, public_abstracts_enabled
     FROM conference_settings WHERE conference_id = ? LIMIT 1`,
    [conferenceId],
  )
  const row = (rows as Array<Record<string, unknown>>)[0]
  if (!row) return { ...DEFAULT_AUDIENCE_SETTINGS }
  return {
    qa_minutes_after_end: Number(row.qa_minutes_after_end),
    audience_feedback_closes_at: row.audience_feedback_closes_at ? new Date(row.audience_feedback_closes_at as string) : null,
    schedule_change_emails: Boolean(row.schedule_change_emails),
    audience_abstracts_enabled: Boolean(row.audience_abstracts_enabled),
    public_abstracts_enabled: Boolean(row.public_abstracts_enabled),
  }
}

/** Plain text only: strips control characters (keeps line breaks), collapses runs of blank lines, trims. */
export function plainText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    // Removes anything that looks like an HTML tag or comment; a bare "<" or ">" in text stays.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
