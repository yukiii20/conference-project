import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { createConference, createDirectSession, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
  // Every normal session is bound to a conference; these tests use the one conference.
  await createConference()
})

afterAll(async () => {
  await pool.end()
})

/** Reads the most recent password_reset email queued for this address and pulls the raw token out of its (not-yet-redacted) reset_url. */
async function latestResetToken(email: string): Promise<string> {
  const [rows] = await pool.query(
    `SELECT template_data FROM email_logs WHERE template_key = 'password_reset' AND recipient_email = ? ORDER BY id DESC LIMIT 1`,
    [email],
  )
  const row = (rows as Array<{ template_data: { reset_url: string } }>)[0]
  expect(row, `no password_reset email was queued for ${email}`).toBeTruthy()
  const url = new URL(row!.template_data.reset_url)
  return url.searchParams.get('token')!
}

describe('forgot password', () => {
  it('gives the same response whether or not the email exists', async () => {
    await createUser({ email: 'real@example.com', password: 'Str0ng!Pass' })

    const realRes = await request(app).post('/api/auth/forgot-password').send({ email: 'real@example.com' })
    const fakeRes = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' })

    expect(realRes.status).toBe(200)
    expect(fakeRes.status).toBe(200)
    expect(realRes.body.message).toBe(fakeRes.body.message)

    const [emailRows] = await pool.query(`SELECT COUNT(*) AS n FROM email_logs WHERE template_key = 'password_reset'`)
    expect((emailRows as Array<{ n: number }>)[0]!.n).toBe(1) // only the real account actually gets one queued
  })

  it('invalidates a previous unused token when a new one is requested', async () => {
    await createUser({ email: 'twice@example.com', password: 'Str0ng!Pass' })

    await request(app).post('/api/auth/forgot-password').send({ email: 'twice@example.com' })
    const firstToken = await latestResetToken('twice@example.com')

    await request(app).post('/api/auth/forgot-password').send({ email: 'twice@example.com' })
    const secondToken = await latestResetToken('twice@example.com')

    const oldAttempt = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: firstToken, password: 'NewStr0ng!Pass1' })
    expect(oldAttempt.status).toBe(400)

    const newAttempt = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: secondToken, password: 'NewStr0ng!Pass1' })
    expect(newAttempt.status).toBe(200)
  })

  it('rejects an expired token', async () => {
    const userId = await createUser({ email: 'expired@example.com', password: 'Str0ng!Pass' })
    await request(app).post('/api/auth/forgot-password').send({ email: 'expired@example.com' })
    const token = await latestResetToken('expired@example.com')

    await pool.query(
      `UPDATE auth_tokens SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 HOUR) WHERE user_id = ? AND purpose = 'password_reset'`,
      [userId],
    )

    const res = await request(app).post('/api/auth/reset-password').send({ token, password: 'NewStr0ng!Pass1' })
    expect(res.status).toBe(400)
  })

  it('rejects reusing an already-used token (single use)', async () => {
    await createUser({ email: 'single-use@example.com', password: 'Str0ng!Pass' })
    await request(app).post('/api/auth/forgot-password').send({ email: 'single-use@example.com' })
    const token = await latestResetToken('single-use@example.com')

    const first = await request(app).post('/api/auth/reset-password').send({ token, password: 'NewStr0ng!Pass1' })
    expect(first.status).toBe(200)

    const second = await request(app).post('/api/auth/reset-password').send({ token, password: 'AnotherStr0ng!1' })
    expect(second.status).toBe(400)
  })

  it('revokes every existing session once the password is reset', async () => {
    const userId = await createUser({ email: 'sessions@example.com', password: 'Str0ng!Pass' })
    const cookie = await createDirectSession(userId)

    const beforeReset = await request(app).get('/api/auth/me').set('Cookie', cookie)
    expect(beforeReset.status).toBe(200)

    await request(app).post('/api/auth/forgot-password').send({ email: 'sessions@example.com' })
    const token = await latestResetToken('sessions@example.com')
    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'NewStr0ng!Pass1' })
    expect(reset.status).toBe(200)

    const afterReset = await request(app).get('/api/auth/me').set('Cookie', cookie)
    expect(afterReset.status).toBe(401)
  })

  it('records an audit log entry for the reset', async () => {
    const userId = await createUser({ email: 'audited@example.com', password: 'Str0ng!Pass' })
    await request(app).post('/api/auth/forgot-password').send({ email: 'audited@example.com' })
    const token = await latestResetToken('audited@example.com')
    await request(app).post('/api/auth/reset-password').send({ token, password: 'NewStr0ng!Pass1' })

    const [rows] = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'user.reset_password' AND entity_id = ?`, [
      userId,
    ])
    expect((rows as unknown[]).length).toBe(1)
  })
})

describe('change password', () => {
  it('keeps the current session but revokes every other one', async () => {
    const userId = await createUser({ email: 'changer@example.com', password: 'Str0ng!Pass' })
    const cookieA = await createDirectSession(userId)
    const cookieB = await createDirectSession(userId)

    const change = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookieA)
      .send({ current_password: 'Str0ng!Pass', new_password: 'NewStr0ng!Pass1' })
    expect(change.status).toBe(200)

    const stillA = await request(app).get('/api/auth/me').set('Cookie', cookieA)
    expect(stillA.status).toBe(200)

    const nowB = await request(app).get('/api/auth/me').set('Cookie', cookieB)
    expect(nowB.status).toBe(401)
  })

  it('rejects the wrong current password', async () => {
    const userId = await createUser({ email: 'wrongpass@example.com', password: 'Str0ng!Pass' })
    const cookie = await createDirectSession(userId)

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ current_password: 'WrongPassword1!', new_password: 'NewStr0ng!Pass1' })
    expect(res.status).toBe(400)
  })
})
