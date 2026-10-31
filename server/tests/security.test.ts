import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { env } from '../src/config/env.js'
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

describe('GET /api/health', () => {
  it('pings the database and reports ok, uptime, and email queue counts with no secrets in the body', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ok: true,
      database: { ok: true },
    })
    expect(typeof res.body.uptime_seconds).toBe('number')
    expect(typeof res.body.email_queue.queued).toBe('number')
    expect(typeof res.body.email_queue.failed_24h).toBe('number')
    // No secrets, no PII, no email addresses/subjects - only operational counts.
    const bodyText = JSON.stringify(res.body)
    expect(bodyText).not.toMatch(/password|secret|token|@.*\.\w+/i)
  })
})

describe('cross-origin request guard', () => {
  it('allows a state-changing request whose Origin matches CLIENT_ORIGIN', async () => {
    const userId = await createUser({ email: 'same-origin@example.com', password: 'Str0ng!Pass' })
    const cookie = await createDirectSession(userId)
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .set('Origin', env.CLIENT_ORIGIN)
      .send({ current_password: 'Str0ng!Pass', new_password: 'NewStr0ng!Pass1' })
    expect(res.status).toBe(200)
  })

  it('rejects a state-changing request from a mismatched Origin', async () => {
    const userId = await createUser({ email: 'cross-origin@example.com', password: 'Str0ng!Pass' })
    const cookie = await createDirectSession(userId)
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example.com')
      .send({ current_password: 'Str0ng!Pass', new_password: 'NewStr0ng!Pass1' })
    expect(res.status).toBe(403)
  })

  it('does not block a safe GET request from a mismatched Origin', async () => {
    const userId = await createUser({ email: 'getter@example.com', password: 'Str0ng!Pass' })
    const cookie = await createDirectSession(userId)
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie).set('Origin', 'https://evil.example.com')
    expect(res.status).toBe(200)
  })
})
