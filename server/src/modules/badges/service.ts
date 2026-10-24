import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { localDateKey } from '../../utils/timezone.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PUBLIC_DIR } from '../../storage/paths.js'
import { generateBadgeSheetPdf, generateSingleBadgePdf, type BadgeConference, type BadgePerson, type BadgeRoleLabel } from './export.js'
import type { BadgeFilterQuery } from './validation.js'

const ROLE_LABELS: Record<string, BadgeRoleLabel> = {
  speaker: 'Speaker',
  author: 'Author',
  reviewer: 'Reviewer',
  staff: 'Staff',
}

export type BadgeCandidate = {
  registration_id: string
  full_name: string
  affiliation: string | null
  category_name: string
  role_label: BadgeRoleLabel
  checked_in_today: boolean
  printed: boolean
}

type CandidateRow = {
  registration_id: string
  full_name: string
  affiliation: string | null
  category_name: string
  qr_token: string
  printed_at: string | null
  role_code: string | null
  checked_in_today: number
}

function toCandidate(row: CandidateRow): BadgeCandidate {
  return {
    registration_id: row.registration_id,
    full_name: row.full_name,
    affiliation: row.affiliation,
    category_name: row.category_name,
    role_label: row.role_code ? ROLE_LABELS[row.role_code]! : 'Attendee',
    checked_in_today: Boolean(row.checked_in_today),
    printed: row.printed_at !== null,
  }
}

async function loadTimezone(conferenceId: string): Promise<string> {
  const [rows] = await pool.query('SELECT timezone FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [
    conferenceId,
  ])
  const timezone = (rows as Array<{ timezone: string }>)[0]?.timezone
  if (!timezone) throw new NotFoundError('This conference does not exist.')
  return timezone
}

function parseIds(raw: string | undefined): string[] | null {
  if (!raw) return null
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return ids.length > 0 ? ids : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function queryCandidates(conferenceId: string, filter: BadgeFilterQuery): Promise<CandidateRow[]> {
  const today = localDateKey(await loadTimezone(conferenceId))
  const ids = parseIds(filter.ids)
  if (ids && ids.some((id) => !UUID_RE.test(id))) {
    throw new BadRequestError('One of the selected rows is not valid.')
  }

  const where = ['r.conference_id = ?']
  const params: unknown[] = [today, conferenceId]
  if (ids) {
    where.push(`r.id IN (${ids.map(() => '?').join(',')})`)
    params.push(...ids)
  } else {
    where.push(`r.status = 'confirmed'`)
    if (filter.category_id) {
      where.push('r.category_id = ?')
      params.push(filter.category_id)
    }
    if (filter.not_printed_only === '1') {
      where.push('r.printed_at IS NULL')
    }
  }

  // An explicit `ids` selection ("selected rows") stands on its own — it bypasses every
  // other filter, not just the WHERE-based ones above, so a chosen row is never silently
  // dropped by a role/checked-in-today filter left over from the screen's filter bar.
  const having: string[] = []
  if (!ids && filter.role) {
    having.push('role_code = ?')
    params.push(filter.role)
  }
  if (!ids && filter.checked_in_today === '1') {
    having.push('checked_in_today = 1')
  }

  const [rows] = await pool.query(
    `SELECT r.id AS registration_id, u.full_name, u.institution AS affiliation, rc.name AS category_name,
            r.qr_token, r.printed_at,
            (SELECT cm.role_code FROM conference_members cm
             WHERE cm.conference_id = r.conference_id AND cm.user_id = r.user_id AND cm.status = 'active'
               AND cm.role_code IN ('speaker','author','reviewer','staff')
             ORDER BY FIELD(cm.role_code, 'speaker','author','reviewer','staff') LIMIT 1) AS role_code,
            EXISTS(SELECT 1 FROM conference_attendance ca WHERE ca.registration_id = r.id AND ca.attendance_date = ?) AS checked_in_today
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     JOIN registration_categories rc ON rc.id = r.category_id
     WHERE ${where.join(' AND ')}
     ${having.length > 0 ? `HAVING ${having.join(' AND ')}` : ''}
     ORDER BY u.full_name`,
    params,
  )
  return rows as CandidateRow[]
}

export async function listBadgeCandidates(conferenceId: string, filter: BadgeFilterQuery): Promise<BadgeCandidate[]> {
  return (await queryCandidates(conferenceId, filter)).map(toCandidate)
}

async function loadConferenceForBadges(conferenceId: string): Promise<BadgeConference> {
  const [rows] = await pool.query(
    'SELECT short_name, code, primary_color, logo_path FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [conferenceId],
  )
  const row = (rows as Array<{ short_name: string | null; code: string; primary_color: string | null; logo_path: string | null }>)[0]
  if (!row) throw new NotFoundError('This conference does not exist.')
  let logoBuffer: Buffer | null = null
  if (row.logo_path) {
    try {
      logoBuffer = await readFile(path.join(PUBLIC_DIR, row.logo_path))
    } catch {
      logoBuffer = null
    }
  }
  return { shortName: row.short_name ?? row.code, primaryColor: row.primary_color ?? '#2747A0', logoBuffer }
}

async function markPrinted(conferenceId: string, actorUserId: string, registrationIds: string[]): Promise<void> {
  if (registrationIds.length === 0) return
  await withTransaction(actorUserId, async (conn) => {
    await conn.query(
      `UPDATE registrations SET printed_at = NOW(3) WHERE conference_id = ? AND id IN (${registrationIds.map(() => '?').join(',')})`,
      [conferenceId, ...registrationIds],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'badge.print',
      entityType: 'registrations',
      newValues: { registration_ids: registrationIds, count: registrationIds.length },
    })
  })
}

/** A4 sheet (2 x 4) of every candidate matching the filter (or the explicit `ids` selection). Marks each as printed. */
export async function generateBadgeSheet(actorUserId: string, conferenceId: string, filter: BadgeFilterQuery): Promise<Buffer> {
  const rows = await queryCandidates(conferenceId, filter)
  if (rows.length === 0) throw new BadRequestError('No one matches the chosen filters.')

  const conference = await loadConferenceForBadges(conferenceId)
  const people: BadgePerson[] = rows.map((r) => ({
    fullName: r.full_name,
    affiliation: r.affiliation,
    roleLabel: r.role_code ? ROLE_LABELS[r.role_code]! : 'Attendee',
    qrToken: r.qr_token,
  }))
  const pdf = await generateBadgeSheetPdf(conference, people)
  await markPrinted(conferenceId, actorUserId, rows.map((r) => r.registration_id))
  return pdf
}

/** One badge for one registration — the staff check-in panel's "Print badge" button, or a convenor per-row print. */
export async function generateSingleBadge(actorUserId: string, conferenceId: string, registrationId: string): Promise<Buffer> {
  const rows = await queryCandidates(conferenceId, { ids: registrationId })
  const row = rows[0]
  if (!row) throw new NotFoundError('This registration does not exist, or is not confirmed.')

  const conference = await loadConferenceForBadges(conferenceId)
  const person: BadgePerson = {
    fullName: row.full_name,
    affiliation: row.affiliation,
    roleLabel: row.role_code ? ROLE_LABELS[row.role_code]! : 'Attendee',
    qrToken: row.qr_token,
  }
  const pdf = await generateSingleBadgePdf(conference, person)
  await markPrinted(conferenceId, actorUserId, [row.registration_id])
  return pdf
}
