import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import type { UpdateConferenceInput } from './manage.validation.js'

const EDITABLE_COLUMNS = [
  'code',
  'name',
  'short_name',
  'tagline',
  'theme',
  'description',
  'welcome_text',
  'submission_guidelines',
  'primary_color',
  'venue_name',
  'address',
  'city',
  'country',
  'location_map_url',
  'contact_email',
  'contact_phone',
  'website_url',
  'start_date',
  'end_date',
] as const

type ConferenceRow = Record<(typeof EDITABLE_COLUMNS)[number], unknown> & { id: string; status: string }

function toDateOnlyString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

export async function getConferenceForManagement(conferenceId: string) {
  const [rows] = await pool.query(
    `SELECT id, slug, code, name, short_name, tagline, theme, description, welcome_text, submission_guidelines,
            logo_path, banner_path, primary_color, venue_name, address, city, country, location_map_url,
            timezone, start_date, end_date, contact_email, contact_phone, website_url, status
     FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [conferenceId],
  )
  const conference = (rows as unknown[])[0]
  if (!conference) throw new NotFoundError('This conference does not exist.')
  return conference
}

export async function updateConference(
  actorUserId: string,
  conferenceId: string,
  input: UpdateConferenceInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT ${EDITABLE_COLUMNS.join(', ')}, status FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [conferenceId],
    )
    const current = (rows as ConferenceRow[])[0]
    if (!current) {
      throw new NotFoundError('This conference does not exist.')
    }

    if (input.code !== undefined && input.code !== current.code && current.status !== 'draft') {
      throw new BadRequestError('The conference code can only be changed while it is still a draft.', {
        code: 'The conference code can only be changed while it is still a draft.',
      })
    }

    const mergedStart = toDateOnlyString(input.start_date ?? current.start_date)
    const mergedEnd = toDateOnlyString(input.end_date ?? current.end_date)
    if (mergedEnd < mergedStart) {
      throw new BadRequestError('End date must be on or after the start date.', {
        end_date: 'End date must be on or after the start date.',
      })
    }

    const assignments: string[] = []
    const values: unknown[] = []
    const oldValues: Record<string, unknown> = {}
    const newValues: Record<string, unknown> = {}

    for (const key of EDITABLE_COLUMNS) {
      if (!(key in input)) continue
      const value = (input as Record<string, unknown>)[key]
      const currentValue = key === 'start_date' || key === 'end_date' ? toDateOnlyString(current[key]) : current[key]
      if (value === currentValue) continue
      assignments.push(`${key} = ?`)
      values.push(value)
      oldValues[key] = currentValue
      newValues[key] = value
    }

    if (assignments.length === 0) return

    values.push(conferenceId)
    await conn.query(`UPDATE conferences SET ${assignments.join(', ')} WHERE id = ?`, values)
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference.update',
      entityType: 'conferences',
      entityId: conferenceId,
      oldValues,
      newValues,
    })
  })
}

export async function setConferenceImagePath(
  actorUserId: string,
  conferenceId: string,
  column: 'logo_path' | 'banner_path',
  newPath: string | null,
): Promise<string | null> {
  return withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT ${column} AS current_path FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [conferenceId],
    )
    const row = (rows as Array<{ current_path: string | null }>)[0]
    if (!row) {
      throw new NotFoundError('This conference does not exist.')
    }

    await conn.query(`UPDATE conferences SET ${column} = ? WHERE id = ?`, [newPath, conferenceId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: `conference.${column}`,
      entityType: 'conferences',
      entityId: conferenceId,
      oldValues: { [column]: row.current_path },
      newValues: { [column]: newPath },
    })

    return row.current_path
  })
}
