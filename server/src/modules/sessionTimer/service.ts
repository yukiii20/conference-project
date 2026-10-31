import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import { getSessionDetail } from '../schedule/service.js'
import type { SessionTimingInput, TimerDefaultsInput } from './validation.js'

/** Used when a conference has no conference_settings row yet. */
export const DEFAULT_TALK_MINUTES = 15
export const DEFAULT_QA_MINUTES = 5

export type TimerDefaults = { talk_minutes: number; qa_minutes: number }

export async function getTimerDefaults(conferenceId: string): Promise<TimerDefaults> {
  const [rows] = await pool.query(
    'SELECT timer_talk_minutes, timer_qa_minutes FROM conference_settings WHERE conference_id = ? LIMIT 1',
    [conferenceId],
  )
  const row = (rows as Array<{ timer_talk_minutes: number; timer_qa_minutes: number }>)[0]
  return {
    talk_minutes: row?.timer_talk_minutes ?? DEFAULT_TALK_MINUTES,
    qa_minutes: row?.timer_qa_minutes ?? DEFAULT_QA_MINUTES,
  }
}

export async function updateTimerDefaults(
  actorUserId: string,
  conferenceId: string,
  input: TimerDefaultsInput,
  audit: AuditContext = {},
): Promise<TimerDefaults> {
  const before = await getTimerDefaults(conferenceId)
  await withTransaction(actorUserId, async (conn) => {
    await conn.query(
      `INSERT INTO conference_settings (conference_id, timer_talk_minutes, timer_qa_minutes) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE timer_talk_minutes = VALUES(timer_talk_minutes), timer_qa_minutes = VALUES(timer_qa_minutes)`,
      [conferenceId, input.talk_minutes, input.qa_minutes],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'timer.defaults_update',
      entityType: 'conference_settings',
      entityId: conferenceId,
      oldValues: before,
      newValues: input,
      ...audit,
    })
  })
  return { talk_minutes: input.talk_minutes, qa_minutes: input.qa_minutes }
}

async function loadSessionTiming(
  conferenceId: string,
  sessionId: string,
): Promise<{ talk_minutes: number | null; qa_minutes: number | null }> {
  const [rows] = await pool.query(
    'SELECT timer_talk_minutes, timer_qa_minutes FROM conference_sessions WHERE id = ? AND conference_id = ? LIMIT 1',
    [sessionId, conferenceId],
  )
  const row = (rows as Array<{ timer_talk_minutes: number | null; timer_qa_minutes: number | null }>)[0]
  if (!row) throw new NotFoundError('This session does not exist.')
  return { talk_minutes: row.timer_talk_minutes, qa_minutes: row.timer_qa_minutes }
}

export async function updateSessionTiming(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  input: SessionTimingInput,
  audit: AuditContext = {},
): Promise<void> {
  const before = await loadSessionTiming(conferenceId, sessionId)
  await withTransaction(actorUserId, async (conn) => {
    await conn.query('UPDATE conference_sessions SET timer_talk_minutes = ?, timer_qa_minutes = ? WHERE id = ? AND conference_id = ?', [
      input.talk_minutes,
      input.qa_minutes,
      sessionId,
      conferenceId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'timer.session_update',
      entityType: 'conference_sessions',
      entityId: sessionId,
      oldValues: before,
      newValues: input,
      ...audit,
    })
  })
}

export type TimerTalk = {
  id: string
  title: string
  speaker: string
  status: string
  presentation_order: number
}

export type TimerData = {
  conference: { id: string; name: string }
  session: { id: string; title: string; starts_at: string; ends_at: string; room_name: string | null }
  /** The minutes the timer actually uses: the session override where set, otherwise the conference default. */
  timing: TimerDefaults
  overrides: { talk_minutes: number | null; qa_minutes: number | null }
  defaults: TimerDefaults
  talks: TimerTalk[]
}

/** Everything the full-screen timer needs, loaded once so the page keeps working offline afterwards. */
export async function getTimerData(conferenceId: string, sessionId: string): Promise<TimerData> {
  const [session, overrides, defaults, confRows] = await Promise.all([
    getSessionDetail(conferenceId, sessionId),
    loadSessionTiming(conferenceId, sessionId),
    getTimerDefaults(conferenceId),
    pool.query('SELECT id, name FROM conferences WHERE id = ? LIMIT 1', [conferenceId]),
  ])
  if (!session) throw new NotFoundError('This session does not exist.')
  const conference = (confRows[0] as Array<{ id: string; name: string }>)[0]!

  // getSessionDetail's presentation rows drop status, which the timer needs to skip finished talks.
  const statuses = new Map<string, string>()
  if (session.presentations.length > 0) {
    const [rows] = await pool.query('SELECT id, status FROM presentations WHERE id IN (?)', [session.presentations.map((p) => p.id)])
    for (const row of rows as Array<{ id: string; status: string }>) statuses.set(row.id, row.status)
  }

  return {
    conference,
    session: {
      id: session.id,
      title: session.title,
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      room_name: session.room?.name ?? null,
    },
    timing: {
      talk_minutes: overrides.talk_minutes ?? defaults.talk_minutes,
      qa_minutes: overrides.qa_minutes ?? defaults.qa_minutes,
    },
    overrides,
    defaults,
    talks: session.presentations.map((p) => ({
      id: p.id,
      title: p.title,
      speaker: p.authors && p.authors.length > 0 ? p.authors.join(', ') : p.speaker_name ?? '',
      status: statuses.get(p.id) ?? 'scheduled',
      presentation_order: p.presentation_order,
    })),
  }
}
