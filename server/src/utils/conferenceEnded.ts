import type { PoolConnection } from 'mysql2/promise'
import { AppError } from './errors.js'
import { PLATFORM_TIMEZONE, zonedWallTimeToUtc } from './timezone.js'

/**
 * "Ended" state of a conference (changes-nov2, Part 2).
 *
 * A conference has ended once its end date is over in Nepal time: from 00:00:00 Asia/Kathmandu
 * on the day after `end_date`. Conferences store only a date (no end time), so the last moment
 * of the end date counts as the end.
 *
 * Mirrored for the UI in src/lib/conferenceEnded.ts - keep the two in step.
 */

export const CONFERENCE_ENDED_CODE = 'conference_ended'
export const CONFERENCE_ENDED_MESSAGE = 'This conference has ended. Conference activity is closed.'

type Queryable = Pick<PoolConnection, 'query'>

function dateKey(value: string | Date): string {
  if (value instanceof Date) {
    // mysql2 returns DATE columns as a local-midnight Date; read the calendar day back the same way.
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(value).slice(0, 10)
}

/** The first instant (UTC) after the conference's end date, in Nepal time. */
export function conferenceEndsAt(endDate: string | Date): Date {
  const [y, m, d] = dateKey(endDate).split('-').map(Number)
  return new Date(zonedWallTimeToUtc(y!, m!, d!, 23, 59, 59, PLATFORM_TIMEZONE).getTime() + 1000)
}

export function isConferenceEnded(endDate: string | Date, now: Date = new Date()): boolean {
  return now.getTime() >= conferenceEndsAt(endDate).getTime()
}

export class ConferenceEndedError extends AppError {
  constructor() {
    super(409, CONFERENCE_ENDED_MESSAGE, undefined, CONFERENCE_ENDED_CODE)
  }
}

/** True when the conference exists and has ended. */
export async function conferenceHasEnded(db: Queryable, conferenceId: string): Promise<boolean> {
  const [rows] = await db.query('SELECT end_date FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [conferenceId])
  const row = (rows as Array<{ end_date: string | Date }>)[0]
  return Boolean(row && isConferenceEnded(row.end_date))
}

/** Throws ConferenceEndedError when the conference has ended. An unknown conference is left to the caller (404 there). */
export async function assertConferenceNotEnded(db: Queryable, conferenceId: string): Promise<void> {
  const [rows] = await db.query('SELECT end_date FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [conferenceId])
  const row = (rows as Array<{ end_date: string | Date }>)[0]
  if (row && isConferenceEnded(row.end_date)) throw new ConferenceEndedError()
}
