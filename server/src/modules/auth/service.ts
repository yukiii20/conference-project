import bcrypt from 'bcryptjs'
import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { generateToken, sha256 } from '../../utils/crypto.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { insertAuditLog } from '../../utils/audit.js'
import { AppError, BadRequestError, ConflictError, UnauthorizedError } from '../../utils/errors.js'
import { env } from '../../config/env.js'
import type { LoginRoleCode, RegisterInput, UpdateProfileInput } from './validation.js'

const BCRYPT_COST = 12
const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = 15
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.'

export type MyRoleRow = {
  role_code: string
  conference_id: string | null
  conference_code: string | null
  conference_name: string | null
  conference_slug: string | null
  conference_status: string | null
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/** Same shape the frontend used to get from the Supabase get_my_roles() RPC. */
export async function getMyRoles(userId: string): Promise<MyRoleRow[]> {
  const [confRows] = await pool.query(
    `SELECT cm.role_code, cm.conference_id, c.code AS conference_code, c.name AS conference_name,
            c.slug AS conference_slug, c.status AS conference_status
     FROM conference_members cm
     JOIN conferences c ON c.id = cm.conference_id
     WHERE cm.user_id = ? AND cm.status = 'active'`,
    [userId],
  )
  const [platformRows] = await pool.query(
    `SELECT role_code, NULL AS conference_id, NULL AS conference_code, NULL AS conference_name,
            NULL AS conference_slug, NULL AS conference_status
     FROM platform_user_roles WHERE user_id = ?`,
    [userId],
  )
  return [...(confRows as MyRoleRow[]), ...(platformRows as MyRoleRow[])]
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT 1 FROM platform_user_roles WHERE user_id = ? AND role_code = 'admin' LIMIT 1`,
    [userId],
  )
  return (rows as unknown[]).length > 0
}

/** Permission codes the user holds in one conference, via their conference_members role. Admins should bypass this and not call it. */
export async function getConferencePermissions(userId: string, conferenceId: string): Promise<Set<string>> {
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
): Promise<{ userId: string }> {
  return withTransaction(null, async (conn) => {
    const [existing] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [input.email])
    if ((existing as unknown[]).length > 0) {
      throw new ConflictError('An account with this email already exists.')
    }

    const [conferenceRows] = await conn.query(
      'SELECT id FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [input.conference_id],
    )
    if ((conferenceRows as unknown[]).length === 0) {
      throw new BadRequestError('Choose a valid conference.', { conference_id: 'Choose a valid conference.' })
    }

    const passwordHash = await hashPassword(input.password)
    const [userResult] = await conn.query(
      `INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)`,
      [input.email, passwordHash, input.full_name, input.phone],
    )
    void userResult

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
        throw new ConflictError('You already have a pending request for this role at this conference.')
      }
      throw err
    }

    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: input.conference_id,
      action: 'user.register',
      entityType: 'users',
      entityId: userId,
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

/** Verifies credentials + role eligibility. Throws before any session is created if anything is wrong. */
export async function verifyLogin(
  email: string,
  password: string,
  role: LoginRoleCode,
): Promise<{ userId: string }> {
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

  if (role === 'convenor') {
    const [rows] = await pool.query(
      `SELECT 1 FROM conference_members WHERE user_id = ? AND role_code = 'convenor' AND status = 'active' LIMIT 1`,
      [user.id],
    )
    if ((rows as unknown[]).length === 0) {
      throw new AppError(403, 'You did not sign up for this role.')
    }
  } else {
    const [rows] = await pool.query(
      `SELECT status, reject_reason FROM role_requests WHERE user_id = ? AND role_code = ?
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, role],
    )
    const request = (rows as Array<{ status: string; reject_reason: string | null }>)[0]
    if (!request) {
      throw new AppError(403, 'You did not sign up for this role.')
    }
    if (request.status === 'pending') {
      throw new AppError(403, "Your account is waiting for the convenor's approval.")
    }
    if (request.status === 'rejected') {
      throw new AppError(403, `Your request was rejected: ${request.reject_reason ?? 'No reason given.'}`)
    }
    if (request.status === 'cancelled') {
      throw new AppError(403, 'You did not sign up for this role.')
    }
  }

  await recordSuccessfulLogin(user.id)
  return { userId: user.id }
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

  const isAdmin = await isPlatformAdmin(user.id)
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
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId])
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await findUserByEmail(email)
  // Always behave the same way whether or not the account exists — the
  // caller (route handler) returns the same response either way.
  if (!user || user.status !== 'active') return

  const rawToken = generateToken()
  const tokenHash = sha256(rawToken)
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)

  await pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, 'password_reset', ?, ?)`,
    [user.id, tokenHash, expiresAt],
  )

  const [templateRows] = await pool.query(
    `SELECT subject, body_html FROM email_templates WHERE conference_id IS NULL AND template_key = 'password_reset' LIMIT 1`,
  )
  const template = (templateRows as Array<{ subject: string; body_html: string }>)[0]
  const resetUrl = `${env.CLIENT_ORIGIN}/reset-password?token=${rawToken}`
  const data = { full_name: user.full_name, reset_url: resetUrl }
  const subject = template ? renderTemplate(template.subject, data) : 'Reset your password'

  const conn = await pool.getConnection()
  try {
    await queueEmail(conn, {
      userId: user.id,
      recipientEmail: user.email,
      templateKey: 'password_reset',
      subject,
      templateData: data,
    })
  } finally {
    conn.release()
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
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
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, row.user_id])
  await pool.query('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [row.id])
  // A reset is a good moment to invalidate any session someone else might be holding.
  await pool.query('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [
    row.user_id,
  ])
}

export async function acceptInvitation(token: string, newPassword: string): Promise<{ userId: string }> {
  const tokenHash = sha256(token)
  const [rows] = await pool.query(
    `SELECT id, user_id FROM auth_tokens
     WHERE token_hash = ? AND purpose = 'invitation' AND used_at IS NULL AND expires_at > NOW(3)
     LIMIT 1`,
    [tokenHash],
  )
  const row = (rows as Array<{ id: string; user_id: string }>)[0]
  if (!row) {
    throw new BadRequestError('This invitation link is invalid or has expired.')
  }

  const newHash = await hashPassword(newPassword)
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, row.user_id])
  await pool.query('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [row.id])
  return { userId: row.user_id }
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
