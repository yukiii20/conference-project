import bcrypt from 'bcryptjs'
import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { PLATFORM_NAME } from '../../email/layout.js'
import { generateToken, sha256 } from '../../utils/crypto.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { notifyUser } from '../../utils/notifications.js'
import { AppError, BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../utils/errors.js'
import { env } from '../../config/env.js'
import { getSessionConferenceId } from '../../middleware/sessionScope.js'
import type { JoinConferenceInput, LoginRoleCode, RegisterInput, SignupRoleCode, UpdateProfileInput } from './validation.js'

const BCRYPT_COST = 12
const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = 15
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.'
export const ACCOUNT_EXISTS_MESSAGE =
  'An account with this email already exists. Enter its password to join this conference, or use another email.'

const ROLE_LABELS: Record<string, string> = {
  author: 'Author',
  reviewer: 'Reviewer',
  session_chair: 'Session Chair',
  staff: 'Staff',
  manager: 'Manager',
  convenor: 'Convenor',
  admin: 'Administrator',
}

export function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code
}

export type MyRoleRow = {
  role_code: string
  conference_id: string | null
  conference_code: string | null
  conference_name: string | null
  conference_slug: string | null
  conference_status: string | null
}

/** The conference fields the sign-in / sign-up / switch flows need. */
export type ConferenceRef = {
  id: string
  slug: string
  name: string
  status: string
  logo_path: string | null
  primary_color: string | null
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Looks a conference up by id or slug (never a deleted one). `publishedOnly`
 * additionally hides drafts — every self-service entry point (sign-up,
 * requesting a role, password-reset branding) uses it. Signing in does not:
 * a convenor works on a draft conference before an admin publishes it, and
 * sign-in still requires an active role there.
 */
export async function findConference(
  ref: string,
  opts: { publishedOnly: boolean },
  conn: PoolConnection | typeof pool = pool,
): Promise<ConferenceRef | null> {
  const value = ref.trim()
  if (!value) return null
  const [rows] = await conn.query(
    `SELECT id, slug, name, status, logo_path, primary_color FROM conferences
     WHERE (id = ? OR slug = ?) AND deleted_at IS NULL ${opts.publishedOnly ? "AND status <> 'draft'" : ''}
     LIMIT 1`,
    [value, value.toLowerCase()],
  )
  return (rows as ConferenceRef[])[0] ?? null
}

/**
 * Same shape the frontend used to get from the previous backend's
 * get_my_roles() RPC. `boundConferenceId` is the conference the caller's
 * session is bound to: when set, ONLY that conference's roles are returned
 * (no other conference, and no platform roles — admin powers come only from
 * an admin session). Null = admin session: every role, as before.
 */
export async function getMyRoles(userId: string, boundConferenceId: string | null = null): Promise<MyRoleRow[]> {
  const [confRows] = await pool.query(
    `SELECT cm.role_code, cm.conference_id, c.code AS conference_code, c.name AS conference_name,
            c.slug AS conference_slug, c.status AS conference_status
     FROM conference_members cm
     JOIN conferences c ON c.id = cm.conference_id AND c.deleted_at IS NULL
     WHERE cm.user_id = ? AND cm.status = 'active' ${boundConferenceId ? 'AND cm.conference_id = ?' : ''}`,
    boundConferenceId ? [userId, boundConferenceId] : [userId],
  )
  if (boundConferenceId) return confRows as MyRoleRow[]
  const [platformRows] = await pool.query(
    `SELECT role_code, NULL AS conference_id, NULL AS conference_code, NULL AS conference_name,
            NULL AS conference_slug, NULL AS conference_status
     FROM platform_user_roles WHERE user_id = ?`,
    [userId],
  )
  return [...(confRows as MyRoleRow[]), ...(platformRows as MyRoleRow[])]
}

/** The raw role check, ignoring the session scope — only for the super-admin sign-in itself. */
async function hasPlatformAdminRole(userId: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT 1 FROM platform_user_roles WHERE user_id = ? AND role_code = 'admin' LIMIT 1`,
    [userId],
  )
  return (rows as unknown[]).length > 0
}

/**
 * True only for a platform admin acting through an UNBOUND session (the
 * super-admin sign-in) — or outside any request (jobs, direct service
 * calls). Inside a session bound to a conference, admin powers never apply:
 * that account is just a member of that conference.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  if (getSessionConferenceId()) return false
  return hasPlatformAdminRole(userId)
}

/** Permission codes the user holds in one conference, via their conference_members role. Admins should bypass this and not call it. */
export async function getConferencePermissions(userId: string, conferenceId: string): Promise<Set<string>> {
  // A session bound to one conference holds no permissions anywhere else,
  // whatever roles the account has there.
  const bound = getSessionConferenceId()
  if (bound && bound !== conferenceId) return new Set()
  const [rows] = await pool.query(
    `SELECT DISTINCT rp.permission_code
     FROM conference_members cm
     JOIN role_permissions rp ON rp.role_code = cm.role_code
     WHERE cm.user_id = ? AND cm.conference_id = ? AND cm.status = 'active'`,
    [userId, conferenceId],
  )
  return new Set((rows as Array<{ permission_code: string }>).map((r) => r.permission_code))
}

export async function registerUser(
  input: RegisterInput,
  ctx: AuditContext = {},
): Promise<{ userId: string }> {
  return withTransaction(null, async (conn) => {
    const [existing] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
    if ((existing as unknown[]).length > 0) {
      // The sign-up page switches to "enter this account's password"
      // (POST /auth/join-conference) when it sees this code.
      throw new AppError(409, ACCOUNT_EXISTS_MESSAGE, undefined, 'account_exists')
    }

    const conference = await findConference(input.conference_id, { publishedOnly: true }, conn)
    if (!conference || conference.id !== input.conference_id) {
      throw new BadRequestError('Choose a valid conference.', { conference_id: 'Choose a valid conference.' })
    }

    const passwordHash = await hashPassword(input.password)
    await conn.query(
      `INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)`,
      [input.email, passwordHash, input.full_name, input.phone],
    )

    const [userRow] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
    const userId = (userRow as Array<{ id: string }>)[0]?.id
    if (!userId) throw new AppError(500, 'Could not create the account.')

    try {
      await conn.query(
        `INSERT INTO role_requests (user_id, conference_id, role_code, status) VALUES (?, ?, ?, 'pending')`,
        [userId, input.conference_id, input.requested_role],
      )
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new AppError(409, 'You already have a pending request for this role at this conference.')
      }
      throw err
    }

    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: input.conference_id,
      action: 'user.register',
      entityType: 'users',
      entityId: userId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })

    const [templateRows] = await conn.query(
      `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'account_created' LIMIT 1`,
    )
    const template = (templateRows as Array<{ subject: string }>)[0]
    const data = { full_name: input.full_name, platform_name: PLATFORM_NAME }
    const subject = template ? renderTemplate(template.subject, data) : `Welcome to ${PLATFORM_NAME}`
    await queueEmail(conn, {
      userId,
      conferenceId: input.conference_id,
      recipientEmail: input.email,
      templateKey: 'account_created',
      subject,
      templateData: data,
    })

    return { userId }
  })
}

type UserRow = {
  id: string
  email: string
  password_hash: string | null
  full_name: string
  status: 'active' | 'suspended' | 'deactivated'
  failed_login_count: number
  locked_until: string | null
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email])
  const row = (rows as UserRow[])[0]
  return row ?? null
}

async function recordFailedLogin(userId: string, currentCount: number): Promise<void> {
  const nextCount = currentCount + 1
  if (nextCount >= MAX_FAILED_LOGINS) {
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
    await pool.query('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?', [
      nextCount,
      lockedUntil,
      userId,
    ])
  } else {
    await pool.query('UPDATE users SET failed_login_count = ? WHERE id = ?', [nextCount, userId])
  }
}

async function recordSuccessfulLogin(userId: string): Promise<void> {
  await pool.query(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?',
    [userId],
  )
}

/** A 403 carrying a machine-readable code, so the sign-in page can offer the right next step. */
function loginRefusal(message: string, code: string): AppError {
  return new AppError(403, message, undefined, code)
}

/**
 * Verifies credentials, then eligibility at ONE conference. Throws before
 * any session is created if anything is wrong.
 *
 * Order matters: the password is checked first, and every refusal before
 * that point is the same generic message — so someone without the password
 * learns nothing about the account, its roles, or which conferences it
 * belongs to. Only after a correct password do the specific per-conference
 * messages (pending / rejected / no role here) appear. A role held at any
 * OTHER conference never counts.
 */
export async function verifyLogin(
  email: string,
  password: string,
  role: LoginRoleCode,
  conferenceRef: string,
  ctx: AuditContext = {},
): Promise<{ userId: string; conference: ConferenceRef }> {
  const user = await findUserByEmail(email)
  if (!user || !user.password_hash) {
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR)
  }

  if (user.status !== 'active') {
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR)
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR)
  }

  const passwordOk = await verifyPassword(password, user.password_hash)
  if (!passwordOk) {
    await recordFailedLogin(user.id, user.failed_login_count)
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR)
  }

  const conference = await findConference(conferenceRef, { publishedOnly: false })
  if (!conference) {
    throw new NotFoundError('Conference not found.')
  }

  const refuse = async (reason: string, message: string): Promise<never> => {
    await auditLoginRefusal(user.id, conference.id, role, reason, ctx)
    throw loginRefusal(message, reason)
  }

  const [activeRows] = await pool.query(
    `SELECT role_code FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active'`,
    [user.id, conference.id],
  )
  const activeRoles = (activeRows as Array<{ role_code: string }>).map((r) => r.role_code)

  if (!activeRoles.includes(role)) {
    if (role !== 'convenor') {
      const [rows] = await pool.query(
        `SELECT status, reject_reason FROM role_requests WHERE user_id = ? AND conference_id = ? AND role_code = ?
         ORDER BY created_at DESC LIMIT 1`,
        [user.id, conference.id, role],
      )
      const request = (rows as Array<{ status: string; reject_reason: string | null }>)[0]
      if (request?.status === 'pending') {
        await refuse(
          'pending_approval',
          `Your ${roleLabel(role)} request at ${conference.name} is waiting for the convenor's approval.`,
        )
      }
      if (request?.status === 'rejected') {
        await refuse(
          'request_rejected',
          `Your ${roleLabel(role)} request at ${conference.name} was rejected: ${request.reject_reason ?? 'No reason given.'}`,
        )
      }
    }

    if (activeRoles.length > 0) {
      await refuse(
        'role_not_held',
        `You don't have the ${roleLabel(role)} role at ${conference.name}. Your roles here: ${activeRoles.map(roleLabel).join(', ')}.`,
      )
    }

    await refuse(
      'no_role_at_conference',
      `This account has no role at ${conference.name} yet. Request a role for this conference, or sign in at a conference where you already have a role.`,
    )
  }

  await recordSuccessfulLogin(user.id)
  return { userId: user.id, conference }
}

/** Sign-in refusals that happen AFTER a correct password — i.e. the right account at the wrong conference or role. */
async function auditLoginRefusal(
  userId: string,
  conferenceId: string,
  role: string,
  reason: string,
  ctx: AuditContext,
): Promise<void> {
  await withTransaction(userId, (conn) =>
    insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: 'auth.login_refused_conference',
      entityType: 'users',
      entityId: userId,
      newValues: { role, reason },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    }),
  )
}

export async function verifyAdminLogin(email: string, password: string): Promise<{ userId: string }> {
  const user = await findUserByEmail(email)
  if (!user || !user.password_hash) {
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR)
  }
  if (user.status !== 'active') {
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR)
  }
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR)
  }

  const passwordOk = await verifyPassword(password, user.password_hash)
  if (!passwordOk) {
    await recordFailedLogin(user.id, user.failed_login_count)
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR)
  }

  const isAdmin = await hasPlatformAdminRole(user.id)
  if (!isAdmin) {
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR)
  }

  await recordSuccessfulLogin(user.id)
  return { userId: user.id }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentSessionId: string,
  ctx: AuditContext = {},
): Promise<void> {
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [userId])
  const row = (rows as Array<{ password_hash: string | null }>)[0]
  if (!row || !row.password_hash) {
    throw new AppError(400, 'This account has no password set.')
  }
  const ok = await verifyPassword(currentPassword, row.password_hash)
  if (!ok) {
    throw new BadRequestError('Current password is incorrect.', { current_password: 'Current password is incorrect.' })
  }
  const newHash = await hashPassword(newPassword)
  await withTransaction(userId, async (conn) => {
    await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId])
    // Keep the session that made this request; every other session held by this user is now stale.
    await conn.query(
      'UPDATE auth_sessions SET revoked_at = NOW(3) WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      [userId, currentSessionId],
    )
    await insertAuditLog(conn, {
      actorUserId: userId,
      action: 'user.change_password',
      entityType: 'users',
      entityId: userId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

/**
 * Shared by the self-service "forgot password" flow and an admin resetting
 * someone's password for them: invalidates any previous unused reset tokens
 * for this user (only the newest link should ever work), issues a new
 * single-use token, and queues the email with the link. When the request
 * came from a conference's own page, the link opens that conference's
 * branded reset page (which then leads to that conference's sign-in).
 */
export async function issuePasswordReset(
  conn: PoolConnection,
  user: { id: string; email: string; full_name: string },
  conference: { slug: string } | null = null,
): Promise<void> {
  await conn.query(
    `UPDATE auth_tokens SET used_at = NOW(3) WHERE user_id = ? AND purpose = 'password_reset' AND used_at IS NULL`,
    [user.id],
  )

  const rawToken = generateToken()
  const tokenHash = sha256(rawToken)
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
  await conn.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, 'password_reset', ?, ?)`,
    [user.id, tokenHash, expiresAt],
  )

  const [templateRows] = await conn.query(
    `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'password_reset' LIMIT 1`,
  )
  const template = (templateRows as Array<{ subject: string }>)[0]
  const resetUrl = conference
    ? `${env.APP_URL}/c/${encodeURIComponent(conference.slug)}/reset-password?token=${rawToken}`
    : `${env.APP_URL}/reset-password?token=${rawToken}`
  const data = { full_name: user.full_name, reset_url: resetUrl }
  const subject = template ? renderTemplate(template.subject, data) : 'Reset your password'

  await queueEmail(conn, {
    userId: user.id,
    recipientEmail: user.email,
    templateKey: 'password_reset',
    subject,
    templateData: data,
  })
}

export async function requestPasswordReset(email: string, conferenceRef?: string | null): Promise<void> {
  const user = await findUserByEmail(email)
  // Always behave the same way whether or not the account exists — the
  // caller (route handler) returns the same response either way.
  if (!user || user.status !== 'active') return
  const conference = conferenceRef ? await findConference(conferenceRef, { publishedOnly: true }) : null
  await withTransaction(user.id, (conn) => issuePasswordReset(conn, user, conference))
}

export async function resetPassword(token: string, newPassword: string, ctx: AuditContext = {}): Promise<void> {
  const tokenHash = sha256(token)
  const [rows] = await pool.query(
    `SELECT id, user_id FROM auth_tokens
     WHERE token_hash = ? AND purpose = 'password_reset' AND used_at IS NULL AND expires_at > NOW(3)
     LIMIT 1`,
    [tokenHash],
  )
  const row = (rows as Array<{ id: string; user_id: string }>)[0]
  if (!row) {
    throw new BadRequestError('This reset link is invalid or has expired.')
  }

  const newHash = await hashPassword(newPassword)
  await withTransaction(row.user_id, async (conn) => {
    await conn.query(
      'UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
      [newHash, row.user_id],
    )
    await conn.query('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [row.id])
    // A reset is a good moment to invalidate every session, including whoever else might be holding one.
    await conn.query('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [
      row.user_id,
    ])
    await insertAuditLog(conn, {
      actorUserId: row.user_id,
      action: 'user.reset_password',
      entityType: 'users',
      entityId: row.user_id,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

export async function acceptInvitation(
  token: string,
  newPassword: string,
  ctx: AuditContext = {},
): Promise<{ userId: string }> {
  const tokenHash = sha256(token)
  const [rows] = await pool.query(
    `SELECT id, user_id, created_by FROM auth_tokens
     WHERE token_hash = ? AND purpose = 'invitation' AND used_at IS NULL AND expires_at > NOW(3)
     LIMIT 1`,
    [tokenHash],
  )
  const row = (rows as Array<{ id: string; user_id: string; created_by: string | null }>)[0]
  if (!row) {
    throw new BadRequestError('This invitation link is invalid or has expired.')
  }

  const newHash = await hashPassword(newPassword)
  await withTransaction(row.user_id, async (conn) => {
    await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, row.user_id])
    await conn.query('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [row.id])
    await insertAuditLog(conn, {
      actorUserId: row.user_id,
      action: 'user.accept_invitation',
      entityType: 'users',
      entityId: row.user_id,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })

    if (row.created_by) {
      const [userRows] = await conn.query('SELECT full_name FROM users WHERE id = ? LIMIT 1', [row.user_id])
      const fullName = (userRows as Array<{ full_name: string }>)[0]?.full_name ?? 'A new user'
      await notifyUser(conn, {
        userId: row.created_by,
        type: 'system',
        title: 'Invitation accepted',
        body: `${fullName} has set their password and can now sign in.`,
      })
    }
  })

  return { userId: row.user_id }
}

/**
 * The conference an invitation-accepting person should be signed in to:
 * the one named in their invitation link, but only if they really hold an
 * active role there. Anything else -> null (no session; they sign in normally).
 */
export async function invitationSessionConference(userId: string, conferenceRef: string | undefined): Promise<ConferenceRef | null> {
  if (!conferenceRef) return null
  const conference = await findConference(conferenceRef, { publishedOnly: false })
  if (!conference) return null
  const [rows] = await pool.query(
    `SELECT 1 FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active' LIMIT 1`,
    [userId, conference.id],
  )
  return (rows as unknown[]).length > 0 ? conference : null
}

// ---------------------------------------------------------------------------
// Joining another conference with an account you already have
// ---------------------------------------------------------------------------

/**
 * Creates a pending role request for `userId` at `conference`, refusing a
 * role the person already holds there or a duplicate pending request.
 * Shared by "join with my existing account" (not signed in) and "request a
 * role while signed in elsewhere".
 */
async function createPendingRoleRequest(
  conn: PoolConnection,
  userId: string,
  conference: ConferenceRef,
  role: SignupRoleCode,
  ctx: AuditContext,
  source: 'join_existing_account' | 'signed_in_request',
): Promise<void> {
  const [activeRows] = await conn.query(
    `SELECT 1 FROM conference_members WHERE user_id = ? AND conference_id = ? AND role_code = ? AND status = 'active' LIMIT 1`,
    [userId, conference.id, role],
  )
  if ((activeRows as unknown[]).length > 0) {
    throw new AppError(
      409,
      `You already have the ${roleLabel(role)} role at ${conference.name}. Sign in at this conference to use it.`,
      undefined,
      'role_already_active',
    )
  }

  const pendingMessage = `You already have a pending ${roleLabel(role)} request at ${conference.name}. You can sign in there once the convenor approves it.`
  const [pendingRows] = await conn.query(
    `SELECT 1 FROM role_requests WHERE user_id = ? AND conference_id = ? AND role_code = ? AND status = 'pending' LIMIT 1`,
    [userId, conference.id, role],
  )
  if ((pendingRows as unknown[]).length > 0) {
    throw new AppError(409, pendingMessage, undefined, 'role_request_pending')
  }

  try {
    await conn.query(
      `INSERT INTO role_requests (user_id, conference_id, role_code, status) VALUES (?, ?, ?, 'pending')`,
      [userId, conference.id, role],
    )
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(409, pendingMessage, undefined, 'role_request_pending')
    }
    throw err
  }

  await insertAuditLog(conn, {
    actorUserId: userId,
    conferenceId: conference.id,
    action: 'role_request.create',
    entityType: 'users',
    entityId: userId,
    newValues: { role_code: role, source },
    ipAddress: ctx.ipAddress ?? null,
    userAgent: ctx.userAgent ?? null,
  })
}

/**
 * Sign-up at a conference with an email that already has an account: the
 * person proves it's theirs with the account's CURRENT password, and only a
 * pending role request for this one conference is created — no new user
 * row, and their name, phone and password are never touched.
 */
export async function joinConferenceWithExistingAccount(
  input: JoinConferenceInput,
  ctx: AuditContext = {},
): Promise<{ conference: ConferenceRef }> {
  const conference = await findConference(input.conference, { publishedOnly: true })
  if (!conference) {
    throw new NotFoundError('Conference not found.')
  }

  const user = await findUserByEmail(input.email)
  const wrongPassword = () =>
    new AppError(401, ACCOUNT_EXISTS_MESSAGE, { password: 'This password is not correct for this account.' }, 'account_exists')
  if (!user || !user.password_hash || user.status !== 'active') throw wrongPassword()
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) throw wrongPassword()

  const passwordOk = await verifyPassword(input.password, user.password_hash)
  if (!passwordOk) {
    // Same brute-force protection (count + lockout) as signing in.
    await recordFailedLogin(user.id, user.failed_login_count)
    throw wrongPassword()
  }

  await withTransaction(user.id, (conn) =>
    createPendingRoleRequest(conn, user.id, conference, input.requested_role, ctx, 'join_existing_account'),
  )
  return { conference }
}

/**
 * A signed-in person asking for a role at a conference OTHER than the one
 * their session is bound to — the one deliberate exception to session
 * scoping. It can only ever create a pending request for the caller
 * themself, at a published conference, for a self-service role.
 */
export async function requestRoleAsSignedInUser(
  userId: string,
  conferenceRef: string,
  role: SignupRoleCode,
  ctx: AuditContext = {},
): Promise<{ conference: ConferenceRef }> {
  const conference = await findConference(conferenceRef, { publishedOnly: true })
  if (!conference) {
    throw new NotFoundError('Conference not found.')
  }
  await withTransaction(userId, (conn) =>
    createPendingRoleRequest(conn, userId, conference, role, ctx, 'signed_in_request'),
  )
  return { conference }
}

// ---------------------------------------------------------------------------
// "My conferences" switcher
// ---------------------------------------------------------------------------

export type MyConferenceRow = {
  conference_id: string
  slug: string
  name: string
  logo_path: string | null
  primary_color: string | null
  status: string
  /** Roles usable there right now. Empty = only pending requests ("Waiting for approval"). */
  roles: string[]
  pending_roles: string[]
}

/**
 * Conferences where the person has an ACTIVE role, plus those where they
 * only have a pending request (shown as "Waiting for approval", never
 * openable). Conferences where they have neither are never listed. Only the
 * caller's own memberships are ever read.
 */
export async function listMyConferences(userId: string): Promise<MyConferenceRow[]> {
  const [activeRows] = await pool.query(
    `SELECT c.id AS conference_id, c.slug, c.name, c.logo_path, c.primary_color, c.status, cm.role_code
     FROM conference_members cm
     JOIN conferences c ON c.id = cm.conference_id AND c.deleted_at IS NULL
     WHERE cm.user_id = ? AND cm.status = 'active'`,
    [userId],
  )
  const [pendingRows] = await pool.query(
    `SELECT c.id AS conference_id, c.slug, c.name, c.logo_path, c.primary_color, c.status, rr.role_code
     FROM role_requests rr
     JOIN conferences c ON c.id = rr.conference_id AND c.deleted_at IS NULL
     WHERE rr.user_id = ? AND rr.status = 'pending'`,
    [userId],
  )

  type Row = Omit<MyConferenceRow, 'roles' | 'pending_roles'> & { role_code: string }
  const byId = new Map<string, MyConferenceRow>()
  const entryFor = (r: Row): MyConferenceRow => {
    let entry = byId.get(r.conference_id)
    if (!entry) {
      entry = {
        conference_id: r.conference_id,
        slug: r.slug,
        name: r.name,
        logo_path: r.logo_path,
        primary_color: r.primary_color,
        status: r.status,
        roles: [],
        pending_roles: [],
      }
      byId.set(r.conference_id, entry)
    }
    return entry
  }
  for (const r of activeRows as Row[]) entryFor(r).roles.push(r.role_code)
  for (const r of pendingRows as Row[]) {
    const entry = entryFor(r)
    if (!entry.roles.includes(r.role_code)) entry.pending_roles.push(r.role_code)
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The person may open `conferenceId` from the switcher only with an active role there (and the conference still exists). */
export async function assertCanSwitchTo(
  userId: string,
  conferenceId: string,
): Promise<{ conference: ConferenceRef; roles: string[] }> {
  const conference = await findConference(conferenceId, { publishedOnly: false })
  if (!conference || conference.id !== conferenceId) {
    throw new NotFoundError('Conference not found.')
  }
  const [rows] = await pool.query(
    `SELECT role_code FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active'`,
    [userId, conferenceId],
  )
  const roles = (rows as Array<{ role_code: string }>).map((r) => r.role_code)
  if (roles.length === 0) {
    throw new ForbiddenError(`You don't have an active role at ${conference.name}. Requests waiting for approval can't be opened yet.`)
  }
  return { conference, roles }
}

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'errno' in err && (err as { errno?: number }).errno === 1062)
}

const PROFILE_COLUMNS = [
  'full_name',
  'phone',
  'institution',
  'department',
  'position',
  'country',
  'orcid',
  'bio',
  'photo_path',
] as const

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<void> {
  const assignments: string[] = []
  const values: unknown[] = []
  for (const column of PROFILE_COLUMNS) {
    const value = input[column]
    if (value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value)
  }
  if (assignments.length === 0) return
  values.push(userId)
  await pool.query(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, values)
}

export async function getUserProfile(userId: string) {
  const [rows] = await pool.query(
    `SELECT id, email, full_name, phone, institution, department, position, bio, country, orcid, photo_path
     FROM users WHERE id = ? LIMIT 1`,
    [userId],
  )
  return (rows as unknown[])[0] ?? null
}

export type { PoolConnection }
