import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

describe('GET /api/auth/session', () => {
  it('answers 200 with an empty identity when signed out (no console 401 on public pages)', async () => {
    const res = await request(app).get('/api/auth/session')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: null, roles: [], isAdmin: false, isSuperAdmin: false, conference: null })
  })

  it('treats an unknown or revoked cookie as signed out, revealing nothing', async () => {
    const res = await request(app).get('/api/auth/session').set('Cookie', 'cms_session=not-a-real-token')
    expect(res.status).toBe(200)
    expect(res.body.user).toBeNull()
  })

  it('returns the same payload as /me for a signed-in member', async () => {
    const conferenceId = await createConference({ name: 'Session Conference' })
    const userId = await createUser({ email: 'session-author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, userId, 'author')
    const cookie = await createDirectSession(userId, conferenceId)

    const session = await request(app).get('/api/auth/session').set('Cookie', cookie)
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie)
    expect(session.status).toBe(200)
    expect(me.status).toBe(200)
    expect(session.body).toEqual(me.body)
    expect(session.body.user.email).toBe('session-author@example.com')
    expect(session.body.conference.id).toBe(conferenceId)
    expect(session.body.isAdmin).toBe(false)
  })

  it('/me still answers 401 when signed out', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401)
  })
})
