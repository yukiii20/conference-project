import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import type { UpdateSettingsInput } from './validation.js'

const COLUMNS = [
  'review_mode',
  'reviews_required',
  'max_submissions_per_author',
  'max_abstract_words',
  'max_file_size_mb',
  'allowed_file_types',
  'authors_see_review_comments',
  'bidding_enabled',
  'bidding_start_at',
  'bidding_end_at',
  'registration_requires_payment',
  'session_attendance_enabled',
  'certificate_min_sessions',
  'default_currency',
  'review_reminders_enabled',
  'review_reminder_days_before',
  'review_overdue_reminder_enabled',
] as const

export type SettingsRow = Record<(typeof COLUMNS)[number], unknown>

// mysql2 returns these BOOLEAN (TINYINT(1)) columns as JS 0/1, not true/false
// - cast them so the frontend's reviewSettingsSchema (z.boolean()) actually
// validates a round-tripped, never-touched field instead of silently failing.
const BOOLEAN_COLUMNS = [
  'authors_see_review_comments',
  'bidding_enabled',
  'registration_requires_payment',
  'session_attendance_enabled',
  'review_reminders_enabled',
  'review_overdue_reminder_enabled',
] as const

function castBooleans(row: SettingsRow): SettingsRow {
  const result = { ...row }
  for (const key of BOOLEAN_COLUMNS) {
    result[key] = Boolean(result[key])
  }
  return result
}

export async function getSettings(conferenceId: string): Promise<SettingsRow> {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS.join(', ')} FROM conference_settings WHERE conference_id = ? LIMIT 1`,
    [conferenceId],
  )
  const row = (rows as SettingsRow[])[0]
  if (!row) throw new NotFoundError('This conference has no settings row yet.')
  return castBooleans(row)
}

export async function updateSettings(
  actorUserId: string,
  conferenceId: string,
  input: UpdateSettingsInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT ${COLUMNS.join(', ')} FROM conference_settings WHERE conference_id = ? LIMIT 1 FOR UPDATE`,
      [conferenceId],
    )
    const currentRaw = (rows as SettingsRow[])[0]
    if (!currentRaw) throw new NotFoundError('This conference has no settings row yet.')
    const current = castBooleans(currentRaw)

    await conn.query(
      `UPDATE conference_settings
       SET review_mode = ?, reviews_required = ?, max_submissions_per_author = ?,
           max_abstract_words = ?, max_file_size_mb = ?, allowed_file_types = ?,
           authors_see_review_comments = ?, bidding_enabled = ?, bidding_start_at = ?, bidding_end_at = ?,
           registration_requires_payment = ?, session_attendance_enabled = ?, certificate_min_sessions = ?,
           default_currency = ?, review_reminders_enabled = ?, review_reminder_days_before = ?,
           review_overdue_reminder_enabled = ?
       WHERE conference_id = ?`,
      [
        input.review_mode,
        input.reviews_required,
        input.max_submissions_per_author,
        input.max_abstract_words,
        input.max_file_size_mb,
        JSON.stringify(input.allowed_file_types),
        input.authors_see_review_comments,
        input.bidding_enabled,
        input.bidding_start_at ? new Date(input.bidding_start_at) : null,
        input.bidding_end_at ? new Date(input.bidding_end_at) : null,
        input.registration_requires_payment,
        input.session_attendance_enabled,
        input.certificate_min_sessions,
        input.default_currency,
        input.review_reminders_enabled,
        JSON.stringify(input.review_reminder_days_before),
        input.review_overdue_reminder_enabled,
        conferenceId,
      ],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'settings.update',
      entityType: 'conference_settings',
      entityId: conferenceId,
      oldValues: current,
      newValues: input,
    })
  })
}
