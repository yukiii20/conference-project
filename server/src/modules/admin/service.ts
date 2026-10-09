import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { generateToken, sha256 } from '../../utils/crypto.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import { env } from '../../config/env.js'
import type {
  AppointConvenorInput,
  AuditLogQuery,
  ConvenorInviteInput,
  CreateConferenceInput,
  ListUsersQuery,
} from './validation.js'

const PAGE_SIZE = 50

/** Escapes LIKE wildcards in user-supplied search text so `%`/`_` aren't treated as patterns. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

const DEFAULT_DEADLINE_OFFSETS: Array<{ deadline_type: string; closes_in_days: number }> = [
  { deadline_type: 'registration', closes_in_days: 60 },
  { deadline_type: 'abstract_submission', closes_in_days: 30 },
  { deadline_type: 'review', closes_in_days: 45 },
  { deadline_type: 'full_paper', closes_in_days: 55 },
  { deadline_type: 'final_paper', closes_in_days: 58 },
]

const INVITATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function listAdminConferences() {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.code, c.slug, c.short_name, c.start_date, c.end_date, c.status,
            u.id AS convenor_id, u.full_name AS convenor_name, u.email AS convenor_email
     FROM conferences c
     LEFT JOIN conference_members cm ON cm.conference_id = c.id AND cm.role_code = 'convenor' AND cm.status = 'active'
     LEFT JOIN users u ON u.id = cm.user_id
     WHERE c.deleted_at IS NULL
     ORDER BY c.created_at DESC`,
  )
  return rows
}

export async function createConference(actorUserId: string, input: CreateConferenceInput): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await conn.query(
      `INSERT INTO conferences (slug, code, name, short_name, city, country, timezone, start_date, end_date, status, social_links, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', JSON_OBJECT(), ?)`,
      [
        input.slug,
        input.code,
        input.name,
        input.short_name,
        input.city ?? null,
        input.country,
        input.timezone,
        input.start_date,
        input.end_date,
        actorUserId,
      ],
    )

    const [rows] = await conn.query('SELECT id FROM conferences WHERE slug = ? LIMIT 1', [input.slug])
    const conferenceId = (rows as Array<{ id: string }>)[0]?.id
    if (!conferenceId) throw new Error('Could not create the conference.')

    await conn.query('INSERT INTO conference_settings (conference_id) VALUES (?)', [conferenceId])

    const now = new Date()
    for (const offset of DEFAULT_DEADLINE_OFFSETS) {
      const closesAt = new Date(now.getTime() + offset.closes_in_days * 24 * 60 * 60 * 1000)
      await conn.query(
        `INSERT INTO conference_deadlines (conference_id, deadline_type, opens_at, closes_at) VALUES (?, ?, ?, ?)`,
        [conferenceId, offset.deadline_type, now, closesAt],
      )
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference.create',
      entityType: 'conferences',
      entityId: conferenceId,
      newValues: { name: input.name, code: input.code, slug: input.slug },
    })

    return { id: conferenceId }
  })
}

/** Parity port of the admin page's existing "Publish" button: draft -> submission_open, nothing else. */
export async function publishConference(actorUserId: string, conferenceId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query("SELECT status FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1", [
      conferenceId,
    ])
    const row = (rows as Array<{ status: string }>)[0]
    if (!row) throw new NotFoundError('This conference does not exist.')
    if (row.status !== 'draft') return

    await conn.query("UPDATE conferences SET status = 'submission_open' WHERE id = ?", [conferenceId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference.publish',
      entityType: 'conferences',
      entityId: conferenceId,
      oldValues: { status: 'draft' },
      newValues: { status: 'submission_open' },
    })
  })
}

/**
 * Shared by appoint-by-email and invite-new-account: deactivates whichever
 * row currently holds the active-convenor flag for this conference (if any)
 * before activating/inserting the new one, so the DB's one-active-convenor
 * unique index is never violated by having both active at once.
 */
async function activateConvenor(
  conn: PoolConnection,
  conferenceId: string,
  userId: string,
  actorUserId: string,
): Promise<void> {
  await conn.query(
    `UPDATE conference_members SET status = 'removed'
     WHERE conference_id = ? AND role_code = 'convenor' AND status = 'active'`,
    [conferenceId],
  )

  const [updateResult] = await conn.query(
    `UPDATE conference_members SET status = 'active' WHERE conference_id = ? AND user_id = ? AND role_code = 'convenor'`,
    [conferenceId, userId],
  )
  if ((updateResult as { affectedRows: number }).affectedRows === 0) {
    await conn.query(
      `INSERT INTO conference_members (conference_id, user_id, role_code, added_by) VALUES (?, ?, 'convenor', ?)`,
      [conferenceId, userId, actorUserId],
    )
  }
}

export async function appointConvenor(
  actorUserId: string,
  conferenceId: string,
  input: AppointConvenorInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [confRows] = await conn.query('SELECT id FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [
      conferenceId,
    ])
    if ((confRows as unknown[]).length === 0) {
      throw new NotFoundError('This conference does not exist.')
    }

    const [userRows] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
    const user = (userRows as Array<{ id: string }>)[0]
    if (!user) {
      throw new NotFoundError('No account exists for that email yet.')
    }

    await activateConvenor(conn, conferenceId, user.id, actorUserId)

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference.appoint_convenor',
      entityType: 'conference_members',
      entityId: user.id,
      newValues: { email: input.email },
    })
  })
}

/**
 * Invites a convenor by email: creates the account (password_hash NULL) and
 * an invitation token if none exists yet, or just appoints straight away if
 * the account already exists (same replace-the-old-convenor logic either
 * way). Email sending isn't wired up yet — queueEmail logs it and prints the
 * link to the console in development.
 */
export async function inviteConvenor(
  actorUserId: string,
  conferenceId: string,
  input: ConvenorInviteInput,
): Promise<{ invited: boolean; appointed: boolean }> {
  return withTransaction(actorUserId, async (conn) => {
    const [confRows] = await conn.query(
      'SELECT id, name FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [conferenceId],
    )
    const conference = (confRows as Array<{ id: string; name: string }>)[0]
    if (!conference) {
      throw new NotFoundError('This conference does not exist.')
    }

    const [existingRows] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
    let userId = (existingRows as Array<{ id: string }>)[0]?.id
    const invited = !userId

    if (invited) {
      await conn.query('INSERT INTO users (email, full_name, phone) VALUES (?, ?, ?)', [
        input.email,
        input.full_name,
        input.phone,
      ])
      const [rows] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
      userId = (rows as Array<{ id: string }>)[0]!.id

      const rawToken = generateToken()
      const tokenHash = sha256(rawToken)
      const expiresAt = new Date(Date.now() + INVITATION_TOKEN_TTL_MS)
      await conn.query(
        `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_by) VALUES (?, 'invitation', ?, ?, ?)`,
        [userId, tokenHash, expiresAt, actorUserId],
      )

      const [templateRows] = await conn.query(
        `SELECT subject, body_html FROM email_templates WHERE conference_id IS NULL AND template_key = 'convenor_invitation' LIMIT 1`,
      )
      const template = (templateRows as Array<{ subject: string; body_html: string }>)[0]
      const inviteUrl = `${env.CLIENT_ORIGIN}/set-password?token=${rawToken}`
      const data = { full_name: input.full_name, conference_name: conference.name, invite_url: inviteUrl }
      const subject = template
        ? renderTemplate(template.subject, data)
        : `You have been appointed convenor of ${conference.name}`

      await queueEmail(conn, {
        userId,
        recipientEmail: input.email,
        templateKey: 'convenor_invitation',
        subject,
        templateData: data,
      })
    }

    await activateConvenor(conn, conferenceId, userId!, actorUserId)

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference.invite_convenor',
      entityType: 'conference_members',
      entityId: userId,
      newValues: { email: input.email, invited },
    })

    return { invited, appointed: true }
  })
}

export type AdminUserRow = {
  id: string
  full_name: string
  email: string
  phone: string | null
  status: 'active' | 'suspended' | 'deactivated'
  created_at: string
}

export async function listUsers(query: ListUsersQuery): Promise<{ users: AdminUserRow[]; page: number }> {
  const conditions: string[] = []
  const params: unknown[] = []

  if (query.query) {
    const pattern = `%${escapeLike(query.query)}%`
    conditions.push(`(full_name LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\')`)
    params.push(pattern, pattern)
  }
  if (query.status) {
    conditions.push('status = ?')
    params.push(query.status)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (query.page - 1) * PAGE_SIZE
  params.push(PAGE_SIZE, offset)

  const [rows] = await pool.query(
    `SELECT id, full_name, email, phone, status, created_at FROM users ${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params,
  )
  return { users: rows as AdminUserRow[], page: query.page }
}

async function countOtherActiveAdmins(conn: PoolConnection, excludeUserId: string): Promise<number> {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS count FROM platform_user_roles pur
     JOIN users u ON u.id = pur.user_id
     WHERE pur.role_code = 'admin' AND u.status = 'active' AND u.id <> ?`,
    [excludeUserId],
  )
  return Number((rows as Array<{ count: number }>)[0]?.count ?? 0)
}

export async function suspendUser(actorUserId: string, targetUserId: string): Promise<void> {
  if (targetUserId === actorUserId) {
    throw new BadRequestError('You cannot suspend your own account.')
  }

  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT id, status FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [targetUserId])
    const user = (rows as Array<{ id: string; status: string }>)[0]
    if (!user) throw new NotFoundError('This user does not exist.')

    const [adminRows] = await conn.query(
      `SELECT 1 FROM platform_user_roles WHERE user_id = ? AND role_code = 'admin' LIMIT 1`,
      [targetUserId],
    )
    const isAdmin = (adminRows as unknown[]).length > 0
    if (isAdmin && (await countOtherActiveAdmins(conn, targetUserId)) === 0) {
      throw new BadRequestError('This is the last active administrator — appoint another admin first.')
    }

    await conn.query("UPDATE users SET status = 'suspended' WHERE id = ?", [targetUserId])
    await conn.query('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [
      targetUserId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      action: 'user.suspend',
      entityType: 'users',
      entityId: targetUserId,
      oldValues: { status: user.status },
      newValues: { status: 'suspended' },
    })
  })
}

export async function reactivateUser(actorUserId: string, targetUserId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT id, status FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [targetUserId])
    const user = (rows as Array<{ id: string; status: string }>)[0]
    if (!user) throw new NotFoundError('This user does not exist.')

    await conn.query(
      "UPDATE users SET status = 'active', failed_login_count = 0, locked_until = NULL WHERE id = ?",
      [targetUserId],
    )
    await insertAuditLog(conn, {
      actorUserId,
      action: 'user.reactivate',
      entityType: 'users',
      entityId: targetUserId,
      oldValues: { status: user.status },
      newValues: { status: 'active' },
    })
  })
}

export async function archiveConference(actorUserId: string, conferenceId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [result] = await conn.query(
      'UPDATE conferences SET deleted_at = NOW(3) WHERE id = ? AND deleted_at IS NULL',
      [conferenceId],
    )
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new NotFoundError('This conference does not exist or is already archived.')
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference.archive',
      entityType: 'conferences',
      entityId: conferenceId,
    })
  })
}

export async function restoreConference(actorUserId: string, conferenceId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [result] = await conn.query(
      'UPDATE conferences SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
      [conferenceId],
    )
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new NotFoundError('This conference does not exist or is not archived.')
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference.restore',
      entityType: 'conferences',
      entityId: conferenceId,
    })
  })
}

async function scalarCount(sql: string): Promise<number> {
  const [rows] = await pool.query(sql)
  return Number((rows as Array<{ count: number }>)[0]?.count ?? 0)
}

export async function getDashboardCounts() {
  const [byStatus, archivedConferences, totalUsers, suspendedUsers, pendingRoleRequests] = await Promise.all([
    pool.query(`SELECT status, COUNT(*) AS count FROM conferences WHERE deleted_at IS NULL GROUP BY status`),
    scalarCount(`SELECT COUNT(*) AS count FROM conferences WHERE deleted_at IS NOT NULL`),
    scalarCount(`SELECT COUNT(*) AS count FROM users`),
    scalarCount(`SELECT COUNT(*) AS count FROM users WHERE status = 'suspended'`),
    scalarCount(`SELECT COUNT(*) AS count FROM role_requests WHERE status = 'pending'`),
  ])

  return {
    conferences_by_status: byStatus[0],
    archived_conferences: archivedConferences,
    total_users: totalUsers,
    suspended_users: suspendedUsers,
    pending_role_requests: pendingRoleRequests,
  }
}

export type AuditLogRow = {
  id: number
  occurred_at: string
  actor_user_id: string | null
  actor_name: string | null
  conference_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  old_values: unknown
  new_values: unknown
}

function buildAuditLogQuery(filters: AuditLogQuery): { where: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.actor) {
    conditions.push('a.actor_user_id = ?')
    params.push(filters.actor)
  }
  if (filters.conference) {
    conditions.push('a.conference_id = ?')
    params.push(filters.conference)
  }
  if (filters.action) {
    conditions.push('a.action = ?')
    params.push(filters.action)
  }
  if (filters.from) {
    conditions.push('a.occurred_at >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    conditions.push('a.occurred_at <= ?')
    params.push(filters.to)
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

export async function listAuditLog(filters: AuditLogQuery): Promise<{ entries: AuditLogRow[]; page: number }> {
  const { where, params } = buildAuditLogQuery(filters)
  const offset = (filters.page - 1) * PAGE_SIZE

  const [rows] = await pool.query(
    `SELECT a.id, a.occurred_at, a.actor_user_id, u.full_name AS actor_name, a.conference_id, a.action,
            a.entity_type, a.entity_id, a.old_values, a.new_values
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ${where}
     ORDER BY a.occurred_at DESC
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset],
  )
  return { entries: rows as AuditLogRow[], page: filters.page }
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  return `"${text.replace(/"/g, '""')}"`
}

const AUDIT_LOG_EXPORT_LIMIT = 5000

export async function exportAuditLogCsv(filters: AuditLogQuery): Promise<string> {
  const { where, params } = buildAuditLogQuery(filters)
  const [rows] = await pool.query(
    `SELECT a.occurred_at, a.actor_user_id, u.full_name AS actor_name, a.conference_id, a.action,
            a.entity_type, a.entity_id, a.old_values, a.new_values
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ${where}
     ORDER BY a.occurred_at DESC
     LIMIT ?`,
    [...params, AUDIT_LOG_EXPORT_LIMIT],
  )

  const header = ['occurred_at', 'actor_user_id', 'actor_name', 'conference_id', 'action', 'entity_type', 'entity_id', 'old_values', 'new_values']
  const lines = [header.join(',')]
  for (const row of rows as AuditLogRow[]) {
    lines.push(header.map((key) => csvCell((row as Record<string, unknown>)[key])).join(','))
  }
  return lines.join('\r\n')
}
