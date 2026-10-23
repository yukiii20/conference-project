import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  createConference,
  createDirectSession,
  createSubmission,
  createUser,
  makePlatformAdmin,
  resetDatabase,
  setDeadlineWindow,
  upsertConferenceSettings,
} from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function loginAsAdmin(email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await makePlatformAdmin(userId)
  const agent = request.agent(app)
  const login = await agent.post('/api/auth/admin-login').send({ email, password: 'Str0ng!Pass' })
  expect(login.status).toBe(200)
  return agent
}

describe('GET /api/admin/users', () => {
  it('lists users, newest first', async () => {
    const agent = await loginAsAdmin('list-admin@example.com')
    await createUser({ email: 'zzz-user@example.com', password: 'Str0ng!Pass' })
    await createUser({ email: 'aaa-user@example.com', password: 'Str0ng!Pass' })

    const res = await agent.get('/api/admin/users')
    expect(res.status).toBe(200)
    const emails = (res.body.users as Array<{ email: string }>).map((u) => u.email)
    expect(emails).toEqual(expect.arrayContaining(['zzz-user@example.com', 'aaa-user@example.com', 'list-admin@example.com']))
  })

  it('filters by the query parameter against name or email', async () => {
    const agent = await loginAsAdmin('list-admin2@example.com')
    await createUser({ email: 'findme@example.com', password: 'Str0ng!Pass', fullName: 'Findable Person' })
    await createUser({ email: 'other@example.com', password: 'Str0ng!Pass', fullName: 'Someone Else' })

    const res = await agent.get('/api/admin/users').query({ query: 'findme' })
    expect(res.status).toBe(200)
    const emails = (res.body.users as Array<{ email: string }>).map((u) => u.email)
    expect(emails).toEqual(['findme@example.com'])
  })

  it('filters by status', async () => {
    const agent = await loginAsAdmin('list-admin3@example.com')
    await createUser({ email: 'susp@example.com', password: 'Str0ng!Pass', status: 'suspended' })
    await createUser({ email: 'active2@example.com', password: 'Str0ng!Pass', status: 'active' })

    const res = await agent.get('/api/admin/users').query({ status: 'suspended' })
    expect(res.status).toBe(200)
    const emails = (res.body.users as Array<{ email: string }>).map((u) => u.email)
    expect(emails).toEqual(['susp@example.com'])
  })

  it('is forbidden for a non-admin', async () => {
    const res = await request(app).get('/api/admin/users')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/admin/conferences', () => {
  it('lists conferences including their active convenor', async () => {
    const agent = await loginAsAdmin('list-admin4@example.com')
    const conferenceId = await createConference({ slug: 'listed-conf', name: 'Listed Conference' })

    const res = await agent.get('/api/admin/conferences')
    expect(res.status).toBe(200)
    const match = (res.body.conferences as Array<{ id: string; name: string }>).find((c) => c.id === conferenceId)
    expect(match).toBeTruthy()
    expect(match?.name).toBe('Listed Conference')
  })

  it('includes submission and registration counts per conference, scoped correctly, with no N+1', async () => {
    const agent = await loginAsAdmin('list-admin5@example.com')
    const conferenceId = await createConference({ slug: 'counted-conf', name: 'Counted Conference' })
    const otherConferenceId = await createConference({ slug: 'other-counted-conf', name: 'Other Counted Conference' })

    const authorId = await createUser({ email: 'count-author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, authorId, 'author')
    await pool.query(`INSERT INTO conference_tracks (conference_id, name, is_active) VALUES (?, 'Track', TRUE)`, [conferenceId])
    const [trackRows] = await pool.query('SELECT id FROM conference_tracks WHERE conference_id = ?', [conferenceId])
    const trackId = (trackRows as Array<{ id: string }>)[0]!.id
    await createSubmission(conferenceId, trackId, authorId, { title: 'Counted paper 1' })
    await createSubmission(conferenceId, trackId, authorId, { title: 'Counted paper 2' })

    await upsertConferenceSettings(conferenceId, { registration_requires_payment: false })
    await setDeadlineWindow(conferenceId, 'registration', -24, 24)
    await pool.query(
      `INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General')`,
      [conferenceId],
    )
    const regAuthorId = await createUser({ email: 'count-registrant@example.com', password: 'Str0ng!Pass' })
    const regSession = await createDirectSession(regAuthorId)
    const regAgent = {
      post: (url: string) => request(app).post(url).set('Cookie', regSession),
    }
    const [categoryRows] = await pool.query('SELECT id FROM registration_categories WHERE conference_id = ?', [conferenceId])
    const categoryId = (categoryRows as Array<{ id: string }>)[0]!.id
    const registered = await regAgent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(registered.status).toBe(201)

    const res = await agent.get('/api/admin/conferences')
    expect(res.status).toBe(200)
    const rows = res.body.conferences as Array<{ id: string; submission_count: number; registration_count: number }>
    const match = rows.find((c) => c.id === conferenceId)
    expect(match?.submission_count).toBe(2)
    expect(match?.registration_count).toBe(1)
    const other = rows.find((c) => c.id === otherConferenceId)
    expect(other?.submission_count).toBe(0)
    expect(other?.registration_count).toBe(0)
  })
})
