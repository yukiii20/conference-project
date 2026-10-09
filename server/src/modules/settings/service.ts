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
] as const

export type SettingsRow = Record<(typeof COLUMNS)[number], unknown>

export async function getSettings(conferenceId: string): Promise<SettingsRow> {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS.join(', ')} FROM conference_settings WHERE conference_id = ? LIMIT 1`,
    [conferenceId],
  )
  const row = (rows as SettingsRow[])[0]
  if (!row) throw new NotFoundError('This conference has no settings row yet.')
  return row
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
    const current = (rows as SettingsRow[])[0]
    if (!current) throw new NotFoundError('This conference has no settings row yet.')

    await conn.query(
      `UPDATE conference_settings
       SET review_mode = ?, reviews_required = ?, max_submissions_per_author = ?,
           max_abstract_words = ?, max_file_size_mb = ?, allowed_file_types = ?,
           authors_see_review_comments = ?
       WHERE conference_id = ?`,
      [
        input.review_mode,
        input.reviews_required,
        input.max_submissions_per_author,
        input.max_abstract_words,
        input.max_file_size_mb,
        JSON.stringify(input.allowed_file_types),
        input.authors_see_review_comments,
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
