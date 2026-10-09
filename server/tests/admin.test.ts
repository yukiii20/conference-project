import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { createUser, makePlatformAdmin, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

describe('admin-only routes', () => {
  it('refuses a normal (non-admin) signed-in user', async () => {
    await createUser({ email: 'plain@example.com', password: 'Str0ng!Pass' })

    const agent = request.agent(app)
    const adminLogin = await agent
      .post('/api/auth/admin-login')
      .send({ email: 'plain@example.com', password: 'Str0ng!Pass' })
    expect(adminLogin.status).toBe(401)
    expect(adminLogin.body.error.message).toBe('Email or password is incorrect.')
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await request(app).get('/api/admin/conferences')
    expect(res.status).toBe(401)
  })

  it('admin logs in -> /me returns the admin role, in the shape the frontend expects', async () => {
    const adminId = await createUser({ email: 'me-admin@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminId)

    const agent = request.agent(app)
    const login = await agent
      .post('/api/auth/admin-login')
      .send({ email: 'me-admin@example.com', password: 'Str0ng!Pass' })
    expect(login.status).toBe(200)

    // Same session, next request: this is exactly where the mysql2 driver
    // timezone bug (Date params marshalled in the host's local timezone
    // instead of UTC) made every admin session look >30 minutes idle
    // immediately after being created.
    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.isAdmin).toBe(true)
    expect(me.body.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role_code: 'admin',
          conference_id: null,
          conference_code: null,
          conference_name: null,
          conference_status: null,
        }),
      ]),
    )
  })

  it('lets an admin create a conference with default key dates', async () => {
    const adminId = await createUser({ email: 'admin@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminId)

    const agent = request.agent(app)
    const login = await agent.post('/api/auth/admin-login').send({ email: 'admin@example.com', password: 'Str0ng!Pass' })
    expect(login.status).toBe(200)

    const createRes = await agent.post('/api/admin/conferences').send({
      name: 'My Test Conference',
      short_name: 'MTC',
      code: 'MTC26',
      slug: 'my-test-conference',
      start_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      country: 'NP',
      timezone: 'Asia/Kathmandu',
    })
    expect(createRes.status).toBe(201)

    const [deadlineRows] = await pool.query('SELECT deadline_type FROM conference_deadlines WHERE conference_id = ?', [
      createRes.body.id,
    ])
    expect((deadlineRows as unknown[]).length).toBe(5)
  })
})
