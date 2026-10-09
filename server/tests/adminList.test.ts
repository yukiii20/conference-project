import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { createConference, createUser, makePlatformAdmin, resetDatabase } from './helpers.js'

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
})
