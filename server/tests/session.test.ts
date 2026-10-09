import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createRoleRequest, createUser, makePlatformAdmin, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

function setCookieString(res: request.Response): string {
  const header = res.headers['set-cookie']
  const value = Array.isArray(header) ? header[0] : header
  if (!value) throw new Error('No Set-Cookie header on response')
  return value
}

describe('GET /api/auth/me', () => {
  it('returns 401 when no cookie is sent at all', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a cookie that does not match any session', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'cms_session=not-a-real-token')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the session so the cookie no longer works afterwards', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'logout@example.com', password: 'Str0ng!Pass' })
    await createRoleRequest(userId, conferenceId, 'author', 'approved')

    const agent = request.agent(app)
    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'logout@example.com', password: 'Str0ng!Pass', role: 'author' })
    expect(login.status).toBe(200)

    const meBefore = await agent.get('/api/auth/me')
    expect(meBefore.status).toBe(200)

    const logout = await agent.post('/api/auth/logout')
    expect(logout.status).toBe(200)

    const meAfter = await agent.get('/api/auth/me')
    expect(meAfter.status).toBe(401)
  })

  it('clears the session cookie in the response', async () => {
    const res = await request(app).post('/api/auth/logout')
    const cookie = setCookieString(res)
    // express' clearCookie sets an already-expired cookie with an empty value.
    expect(cookie).toMatch(/cms_session=;/)
  })
})

describe('session cookie attributes', () => {
  it('login sets HttpOnly + SameSite=Lax, and no Max-Age when remember_me is false', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'cookie1@example.com', password: 'Str0ng!Pass' })
    await createRoleRequest(userId, conferenceId, 'author', 'approved')

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cookie1@example.com', password: 'Str0ng!Pass', role: 'author', remember_me: false })
    expect(res.status).toBe(200)

    const cookie = setCookieString(res)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).not.toMatch(/Max-Age/i)

    const [rows] = await pool.query('SELECT remember_me FROM auth_sessions WHERE user_id = ?', [userId])
    expect(Boolean((rows as Array<{ remember_me: number }>)[0]!.remember_me)).toBe(false)
  })

  it('login sets a ~30 day Max-Age when remember_me is true', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'cookie2@example.com', password: 'Str0ng!Pass' })
    await createRoleRequest(userId, conferenceId, 'author', 'approved')

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cookie2@example.com', password: 'Str0ng!Pass', role: 'author', remember_me: true })
    expect(res.status).toBe(200)

    const cookie = setCookieString(res)
    const match = cookie.match(/Max-Age=(\d+)/i)
    expect(match).not.toBeNull()
    const maxAgeSeconds = Number(match![1])
    const thirtyDaysSeconds = 30 * 24 * 60 * 60
    expect(maxAgeSeconds).toBeGreaterThan(thirtyDaysSeconds - 60)
    expect(maxAgeSeconds).toBeLessThanOrEqual(thirtyDaysSeconds)

    const [rows] = await pool.query(
      'SELECT remember_me, TIMESTAMPDIFF(SECOND, NOW(3), expires_at) AS ttl FROM auth_sessions WHERE user_id = ?',
      [userId],
    )
    const row = (rows as Array<{ remember_me: number; ttl: number }>)[0]!
    expect(Boolean(row.remember_me)).toBe(true)
    expect(row.ttl).toBeGreaterThan(thirtyDaysSeconds - 60)
  })

  it('admin-login never remembers, regardless of what the caller asks for', async () => {
    const adminId = await createUser({ email: 'cookie-admin@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminId)

    const res = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'cookie-admin@example.com', password: 'Str0ng!Pass' })
    expect(res.status).toBe(200)

    const cookie = setCookieString(res)
    expect(cookie).not.toMatch(/Max-Age/i)

    const [rows] = await pool.query('SELECT remember_me, is_admin_session FROM auth_sessions WHERE user_id = ?', [
      adminId,
    ])
    const row = (rows as Array<{ remember_me: number; is_admin_session: number }>)[0]!
    expect(Boolean(row.remember_me)).toBe(false)
    expect(Boolean(row.is_admin_session)).toBe(true)
  })
})

describe('admin-login generic error for a locked account', () => {
  it('gives the same generic message once the account is locked', async () => {
    await createUser({ email: 'locked-admin@example.com', password: 'Str0ng!Pass' })

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/admin-login')
        .send({ email: 'locked-admin@example.com', password: 'WrongPassword1!' })
    }

    const res = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'locked-admin@example.com', password: 'Str0ng!Pass' })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Email or password is incorrect.')
  })
})

describe('authorization boundaries', () => {
  it('an authenticated non-admin gets 403 (not a crash) from an admin-only API', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'plain-session@example.com', password: 'Str0ng!Pass' })
    await createRoleRequest(userId, conferenceId, 'author', 'approved')

    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email: 'plain-session@example.com', password: 'Str0ng!Pass', role: 'author' })

    const res = await agent.get('/api/admin/conferences')
    expect(res.status).toBe(403)
  })

  it('an author gets 403 editing a conference (a convenor-only API)', async () => {
    const conferenceId = await createConference()
    const authorId = await createUser({ email: 'author-only@example.com', password: 'Str0ng!Pass' })
    await createRoleRequest(authorId, conferenceId, 'author', 'approved')

    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email: 'author-only@example.com', password: 'Str0ng!Pass', role: 'author' })

    const res = await agent.patch(`/api/conferences/${conferenceId}`).send({ name: 'Hijacked' })
    expect(res.status).toBe(403)
  })
})
