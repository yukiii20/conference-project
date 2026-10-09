import type { Request, Response } from 'express'
import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { generateToken, sha256 } from '../../utils/crypto.js'
import { isProduction } from '../../config/env.js'

export const SESSION_COOKIE = 'cms_session'

export const REMEMBER_ME_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
export const DEFAULT_SESSION_MS = 12 * 60 * 60 * 1000 // 12 hours
export const ADMIN_IDLE_MS = 30 * 60 * 1000 // 30 minutes

export type SessionUser = {
  id: string
  email: string
  fullName: string
  status: 'active' | 'suspended' | 'deactivated'
  isAdminSession: boolean
  sessionId: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

type CreateSessionInput = {
  userId: string
  rememberMe: boolean
  isAdminSession: boolean
  userAgent?: string | null
  ipAddress?: string | null
}

/** Creates the DB session row and sets the cookie. Admin sessions never remember-me and use a short idle window. */
export async function createSession(
  conn: PoolConnection,
  res: Response,
  input: CreateSessionInput,
): Promise<void> {
  const token = generateToken()
  const tokenHash = sha256(token)
  const rememberMe = input.isAdminSession ? false : input.rememberMe
  const ttlMs = input.isAdminSession ? ADMIN_IDLE_MS : rememberMe ? REMEMBER_ME_MS : DEFAULT_SESSION_MS
  const expiresAt = new Date(Date.now() + ttlMs)

  await conn.query(
    `INSERT INTO auth_sessions (user_id, token_hash, remember_me, is_admin_session, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.userId, tokenHash, rememberMe, input.isAdminSession, input.userAgent ?? null, input.ipAddress ?? null, expiresAt],
  )

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    // Omitting maxAge makes it a browser-session cookie (cleared on browser close),
    // which is what we want for both "not remembered" and admin sessions.
    ...(rememberMe ? { maxAge: REMEMBER_ME_MS } : {}),
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

export function getSessionToken(req: Request): string | undefined {
  const raw = req.cookies?.[SESSION_COOKIE]
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/**
 * Validates the session cookie against auth_sessions + users, sliding the
 * idle window for admin sessions, and revoking sessions whose user is no
 * longer active. Returns null (and revokes if admin-idle-expired) when the
 * session isn't valid — callers decide whether that's an error.
 */
export async function resolveSessionUser(req: Request): Promise<SessionUser | null> {
  const token = getSessionToken(req)
  if (!token) return null

  const tokenHash = sha256(token)
  const [rows] = await pool.query(
    `SELECT s.id AS session_id, s.user_id, s.remember_me, s.is_admin_session, s.last_seen_at, s.expires_at,
            u.email, u.full_name, u.status
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL
     LIMIT 1`,
    [tokenHash],
  )
  const row = (rows as any[])[0]
  if (!row) return null

  const now = Date.now()

  if (row.is_admin_session) {
    const lastSeen = new Date(row.last_seen_at).getTime()
    if (now - lastSeen > ADMIN_IDLE_MS) {
      await pool.query('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE id = ?', [row.session_id])
      return null
    }
    await pool.query('UPDATE auth_sessions SET last_seen_at = NOW(3), expires_at = ? WHERE id = ?', [
      new Date(now + ADMIN_IDLE_MS),
      row.session_id,
    ])
  } else {
    if (new Date(row.expires_at).getTime() < now) {
      return null
    }
    await pool.query('UPDATE auth_sessions SET last_seen_at = NOW(3) WHERE id = ?', [row.session_id])
  }

  if (row.status !== 'active') {
    await pool.query('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE id = ?', [row.session_id])
    return null
  }

  return {
    id: row.user_id,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    isAdminSession: Boolean(row.is_admin_session),
    sessionId: row.session_id,
  }
}

export async function revokeSession(sessionId: string): Promise<void> {
  await pool.query('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE id = ?', [sessionId])
}
