import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { issuePasswordReset } from '../auth/service.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { generateToken, sha256 } from '../../utils/crypto.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import { env } from '../../config/env.js'
import { pingDatabase, getStorageDiskSpace } from '../../utils/health.js'
import type {
  AppointConvenorInput,
  AuditLogQuery,
  ConvenorInviteInput,
  CreateConferenceInput,
  GrantAdminInput,
  ListConferencesQuery,
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

export async function listAdminConferences(filters: ListConferencesQuery = {}) {
  const conditions: string[] = ['c.deleted_at IS NULL']
  const params: unknown[] = []

  if (filters.query) {
    const pattern = `%${escapeLike(filters.query)}%`
    conditions.push(`(c.name LIKE ? ESCAPE '\\\\' OR c.code LIKE ? ESCAPE '\\\\' OR c.slug LIKE ? ESCAPE '\\\\')`)
    params.push(pattern, pattern, pattern)
  }
  if (filters.status) {
    conditions.push('c.status = ?')
    params.push(filters.status)
  }

  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.code, c.slug, c.short_name, c.start_date, c.end_date, c.status,
            u.id AS convenor_id, u.full_name AS convenor_name, u.email AS convenor_email
     FROM conferences c
     LEFT JOIN conference_members cm ON cm.conference_id = c.id AND cm.role_code = 'convenor' AND cm.status = 'active'
     LEFT JOIN users u ON u.id = cm.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.created_at DESC`,
    params,
  )
  return rows
}

export async function createConference(
  actorUserId: string,
  input: CreateConferenceInput,
  ctx: AuditContext = {},
): Promise<{ id: string }> {
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
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })

    return { id: conferenceId }
  })
}

/** Parity port of the admin page's existing "Publish" button: draft -> submission_open, nothing else. */
export async function publishConference(
  actorUserId: string,
  conferenceId: string,
  ctx: AuditContext = {},
): Promise<void> {
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
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

const UNPUBLISHABLE_STATUSES = new Set([
  'registration_open',
  'submission_open',
  'under_review',
  'scheduling',
  'published',
])

/** Reverses publish back to draft — only from a status before the conference actually ran (never from ongoing/completed/closed). */
export async function unpublishConference(
  actorUserId: string,
  conferenceId: string,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query("SELECT status FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1", [
      conferenceId,
    ])
    const row = (rows as Array<{ status: string }>)[0]
    if (!row) throw new NotFoundError('This conference does not exist.')
    if (row.status === 'draft') return
    if (!UNPUBLISHABLE_STATUSES.has(row.status)) {
      throw new BadRequestError('This conference has already run and can no longer be unpublished.')
    }

    await conn.query("UPDATE conferences SET status = 'draft' WHERE id = ?", [conferenceId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference.unpublish',
      entityType: 'conferences',
      entityId: conferenceId,
      oldValues: { status: row.status },
      newValues: { status: 'draft' },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
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
  ctx: AuditContext = {},
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
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
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
  ctx: AuditContext = {},
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
      const inviteUrl = `${env.APP_URL}/set-password?token=${rawToken}`
      const data = { full_name: input.full_name, conference_name: conference.name, invite_url: inviteUrl }
      const subject = template
        ? renderTemplate(template.subject, data)
        : `You have been appointed convenor of ${conference.name}`

      await queueEmail(conn, {
        userId,
        conferenceId,
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
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })

    return { invited, appointed: true }
  })
}

export type ConferenceStats = {
  submissions_by_status: Array<{ status: string; count: number }>
  registrations_by_status: Array<{ status: string; count: number }>
  members_by_role: Array<{ role_code: string; count: number }>
}

export async function getConferenceStats(conferenceId: string): Promise<ConferenceStats> {
  const [confRows] = await pool.query('SELECT id FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [
    conferenceId,
  ])
  if ((confRows as unknown[]).length === 0) throw new NotFoundError('This conference does not exist.')

  const [submissions, registrations, members] = await Promise.all([
    pool.query(
      'SELECT status, COUNT(*) AS count FROM submissions WHERE conference_id = ? AND deleted_at IS NULL GROUP BY status',
      [conferenceId],
    ),
    pool.query('SELECT status, COUNT(*) AS count FROM registrations WHERE conference_id = ? GROUP BY status', [
      conferenceId,
    ]),
    pool.query(
      "SELECT role_code, COUNT(*) AS count FROM conference_members WHERE conference_id = ? AND status = 'active' GROUP BY role_code",
      [conferenceId],
    ),
  ])

  return {
    submissions_by_status: submissions[0] as Array<{ status: string; count: number }>,
    registrations_by_status: registrations[0] as Array<{ status: string; count: number }>,
    members_by_role: members[0] as Array<{ role_code: string; count: number }>,
  }
}

/** Audit-only: records that an admin opened a conference's convenor portal in read-only "view as" mode. */
export async function recordViewAsAdmin(
  actorUserId: string,
  conferenceId: string,
  ctx: AuditContext = {},
): Promise<{ slug: string }> {
  const [rows] = await pool.query('SELECT id, slug FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [
    conferenceId,
  ])
  const conference = (rows as Array<{ id: string; slug: string }>)[0]
  if (!conference) throw new NotFoundError('This conference does not exist.')

  await withTransaction(actorUserId, async (conn) => {
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference.view_as_admin',
      entityType: 'conferences',
      entityId: conferenceId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })

  return { slug: conference.slug }
}

export type AdminUserRow = {
  id: string
  full_name: string
  email: string
  phone: string | null
  status: 'active' | 'suspended' | 'deactivated'
  failed_login_count: number
  locked_until: string | null
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
    `SELECT id, full_name, email, phone, status, failed_login_count, locked_until, created_at FROM users ${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params,
  )
  return { users: rows as AdminUserRow[], page: query.page }
}

export type UserDetail = {
  id: string
  full_name: string
  email: string
  phone: string | null
  status: 'active' | 'suspended' | 'deactivated'
  failed_login_count: number
  locked_until: string | null
  last_login_at: string | null
  created_at: string
  memberships: Array<{
    conference_id: string
    conference_name: string
    conference_slug: string
    role_code: string
    status: 'active' | 'removed'
  }>
}

export async function getUserDetail(targetUserId: string): Promise<UserDetail> {
  const [userRows] = await pool.query(
    `SELECT id, full_name, email, phone, status, failed_login_count, locked_until, last_login_at, created_at
     FROM users WHERE id = ? LIMIT 1`,
    [targetUserId],
  )
  const user = (userRows as Array<Omit<UserDetail, 'memberships'>>)[0]
  if (!user) throw new NotFoundError('This user does not exist.')

  const [memberRows] = await pool.query(
    `SELECT c.id AS conference_id, c.name AS conference_name, c.slug AS conference_slug, cm.role_code, cm.status
     FROM conference_members cm
     JOIN conferences c ON c.id = cm.conference_id
     WHERE cm.user_id = ?
     ORDER BY c.name, cm.role_code`,
    [targetUserId],
  )

  return { ...user, memberships: memberRows as UserDetail['memberships'] }
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

const LOCK_VERBS: Record<'suspended' | 'deactivated', string> = { suspended: 'suspend', deactivated: 'deactivate' }

/** Shared by suspend (temporary block) and deactivate (the account holder/admin has fully deactivated this account) — same last-admin protection and session revocation, different target status + audit action. */
async function lockUserAccount(
  actorUserId: string,
  targetUserId: string,
  status: 'suspended' | 'deactivated',
  auditAction: 'user.suspend' | 'user.deactivate',
  ctx: AuditContext = {},
): Promise<void> {
  if (targetUserId === actorUserId) {
    throw new BadRequestError(`You cannot ${LOCK_VERBS[status]} your own account.`)
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

    await conn.query('UPDATE users SET status = ? WHERE id = ?', [status, targetUserId])
    await conn.query('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [
      targetUserId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      action: auditAction,
      entityType: 'users',
      entityId: targetUserId,
      oldValues: { status: user.status },
      newValues: { status },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

export async function suspendUser(actorUserId: string, targetUserId: string, ctx: AuditContext = {}): Promise<void> {
  await lockUserAccount(actorUserId, targetUserId, 'suspended', 'user.suspend', ctx)
}

/** A second, distinct lifecycle action from suspend (status='deactivated' instead of 'suspended') — same protections, its own audit trail entry. */
export async function deactivateUser(
  actorUserId: string,
  targetUserId: string,
  ctx: AuditContext = {},
): Promise<void> {
  await lockUserAccount(actorUserId, targetUserId, 'deactivated', 'user.deactivate', ctx)
}

/** Clears a failed-login lockout without touching status — safe to call on an already-active, merely-locked-out account. */
export async function unlockUser(actorUserId: string, targetUserId: string, ctx: AuditContext = {}): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      'SELECT id, failed_login_count, locked_until FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
      [targetUserId],
    )
    const user = (rows as Array<{ id: string; failed_login_count: number; locked_until: string | null }>)[0]
    if (!user) throw new NotFoundError('This user does not exist.')

    await conn.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [targetUserId])
    await insertAuditLog(conn, {
      actorUserId,
      action: 'user.unlock',
      entityType: 'users',
      entityId: targetUserId,
      oldValues: { failed_login_count: user.failed_login_count, locked_until: user.locked_until },
      newValues: { failed_login_count: 0, locked_until: null },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

export async function reactivateUser(
  actorUserId: string,
  targetUserId: string,
  ctx: AuditContext = {},
): Promise<void> {
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
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

/** Sends the same reset-password link a self-service request would — never shows or sets a password directly. */
export async function adminResetUserPassword(
  actorUserId: string,
  targetUserId: string,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      'SELECT id, email, full_name, status FROM users WHERE id = ? LIMIT 1',
      [targetUserId],
    )
    const user = (rows as Array<{ id: string; email: string; full_name: string; status: string }>)[0]
    if (!user) throw new NotFoundError('This user does not exist.')
    if (user.status !== 'active') {
      throw new BadRequestError('This account is not active.')
    }

    await issuePasswordReset(conn, user)
    await insertAuditLog(conn, {
      actorUserId,
      action: 'user.admin_reset_password',
      entityType: 'users',
      entityId: targetUserId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

export type PlatformAdminRow = { id: string; full_name: string; email: string; status: string; granted_at: string }

export async function listPlatformAdmins(): Promise<PlatformAdminRow[]> {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.status, pur.granted_at
     FROM platform_user_roles pur
     JOIN users u ON u.id = pur.user_id
     WHERE pur.role_code = 'admin'
     ORDER BY u.full_name`,
  )
  return rows as PlatformAdminRow[]
}

export async function grantAdmin(
  actorUserId: string,
  input: GrantAdminInput,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [userRows] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
    const user = (userRows as Array<{ id: string }>)[0]
    if (!user) throw new NotFoundError('No account exists for that email yet.')

    const [existing] = await conn.query(
      `SELECT 1 FROM platform_user_roles WHERE user_id = ? AND role_code = 'admin' LIMIT 1`,
      [user.id],
    )
    if ((existing as unknown[]).length > 0) return

    await conn.query(`INSERT INTO platform_user_roles (user_id, role_code, granted_by) VALUES (?, 'admin', ?)`, [
      user.id,
      actorUserId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      action: 'admin.grant',
      entityType: 'platform_user_roles',
      entityId: user.id,
      newValues: { email: input.email },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

export async function revokeAdmin(
  actorUserId: string,
  targetUserId: string,
  ctx: AuditContext = {},
): Promise<void> {
  if (targetUserId === actorUserId) {
    throw new BadRequestError('You cannot remove your own administrator access.')
  }

  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT 1 FROM platform_user_roles WHERE user_id = ? AND role_code = 'admin' LIMIT 1 FOR UPDATE`,
      [targetUserId],
    )
    if ((rows as unknown[]).length === 0) throw new NotFoundError('This user is not an administrator.')

    if ((await countOtherActiveAdmins(conn, targetUserId)) === 0) {
      throw new BadRequestError('This is the last active administrator — appoint another admin first.')
    }

    await conn.query(`DELETE FROM platform_user_roles WHERE user_id = ? AND role_code = 'admin'`, [targetUserId])
    await insertAuditLog(conn, {
      actorUserId,
      action: 'admin.revoke',
      entityType: 'platform_user_roles',
      entityId: targetUserId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

const ANONYMIZED_PROFILE_COLUMNS = [
  'phone',
  'institution',
  'department',
  'position',
  'country',
  'orcid',
  'bio',
  'photo_path',
] as const

/**
 * Replaces a user's identifying profile fields with placeholders while
 * leaving their id intact, so every row that references user_id (submissions,
 * reviews, registrations, ...) keeps working — only the person's own PII is
 * gone. Refuses on a platform admin or the acting admin's own account, same
 * as suspend/deactivate's admin-protection style.
 */
export async function anonymizeUser(
  actorUserId: string,
  targetUserId: string,
  ctx: AuditContext = {},
): Promise<void> {
  if (targetUserId === actorUserId) {
    throw new BadRequestError('You cannot anonymise your own account.')
  }

  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, full_name, email, phone, institution, department, position, country, orcid, bio, photo_path, status
       FROM users WHERE id = ? LIMIT 1 FOR UPDATE`,
      [targetUserId],
    )
    const user = (rows as Array<Record<string, unknown>>)[0]
    if (!user) throw new NotFoundError('This user does not exist.')

    const [adminRows] = await conn.query(
      `SELECT 1 FROM platform_user_roles WHERE user_id = ? AND role_code = 'admin' LIMIT 1`,
      [targetUserId],
    )
    if ((adminRows as unknown[]).length > 0) {
      throw new BadRequestError('An administrator account cannot be anonymised — remove admin access first.')
    }

    const placeholderEmail = `anon+${generateToken().slice(0, 16)}@anonymized.invalid`
    await conn.query(
      `UPDATE users SET full_name = 'Anonymised user', email = ?, ${ANONYMIZED_PROFILE_COLUMNS.map((c) => `${c} = NULL`).join(', ')},
              status = 'deactivated', anonymized_at = NOW(3)
       WHERE id = ?`,
      [placeholderEmail, targetUserId],
    )
    await conn.query('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [
      targetUserId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      action: 'user.anonymize',
      entityType: 'users',
      entityId: targetUserId,
      oldValues: { ...user, password_hash: undefined },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

export async function archiveConference(
  actorUserId: string,
  conferenceId: string,
  ctx: AuditContext = {},
): Promise<void> {
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
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

export async function restoreConference(
  actorUserId: string,
  conferenceId: string,
  ctx: AuditContext = {},
): Promise<void> {
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
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

async function scalarCount(sql: string): Promise<number> {
  const [rows] = await pool.query(sql)
  return Number((rows as Array<{ count: number }>)[0]?.count ?? 0)
}

async function getRecentAuditLog(limit: number): Promise<AuditLogRow[]> {
  const [rows] = await pool.query(
    `SELECT a.id, a.occurred_at, a.actor_user_id, u.full_name AS actor_name, a.conference_id, a.action,
            a.entity_type, a.entity_id, a.old_values, a.new_values
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ORDER BY a.occurred_at DESC
     LIMIT ?`,
    [limit],
  )
  return rows as AuditLogRow[]
}

export async function getDashboardCounts() {
  const [
    byStatus,
    archivedConferences,
    totalUsers,
    suspendedUsers,
    pendingRoleRequests,
    totalSubmissions,
    activeRegistrations,
    failedEmails24h,
    queuedEmails,
    recentActions,
    dbHealth,
    diskSpace,
  ] = await Promise.all([
    pool.query(`SELECT status, COUNT(*) AS count FROM conferences WHERE deleted_at IS NULL GROUP BY status`),
    scalarCount(`SELECT COUNT(*) AS count FROM conferences WHERE deleted_at IS NOT NULL`),
    scalarCount(`SELECT COUNT(*) AS count FROM users`),
    scalarCount(`SELECT COUNT(*) AS count FROM users WHERE status = 'suspended'`),
    scalarCount(`SELECT COUNT(*) AS count FROM role_requests WHERE status = 'pending'`),
    scalarCount(`SELECT COUNT(*) AS count FROM submissions WHERE deleted_at IS NULL`),
    scalarCount(`SELECT COUNT(*) AS count FROM registrations WHERE active_flag = 1`),
    scalarCount(`SELECT COUNT(*) AS count FROM email_logs WHERE status = 'failed' AND queued_at >= NOW(3) - INTERVAL 24 HOUR`),
    scalarCount(`SELECT COUNT(*) AS count FROM email_logs WHERE status = 'queued'`),
    getRecentAuditLog(10),
    pingDatabase(),
    getStorageDiskSpace(),
  ])

  return {
    conferences_by_status: byStatus[0],
    archived_conferences: archivedConferences,
    total_users: totalUsers,
    suspended_users: suspendedUsers,
    pending_role_requests: pendingRoleRequests,
    total_submissions: totalSubmissions,
    active_registrations: activeRegistrations,
    recent_actions: recentActions,
    health: {
      database: dbHealth,
      email_mode: env.EMAIL_MODE,
      failed_emails_24h: failedEmails24h,
      queued_emails: queuedEmails,
      storage_disk: diskSpace,
    },
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
