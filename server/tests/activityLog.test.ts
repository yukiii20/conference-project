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

function cookieAgent(cookie: string) {
  return { get: (url: string) => request(app).get(url).set('Cookie', cookie), post: (url: string) => request(app).post(url).set('Cookie', cookie) }
}

async function loginAs(conferenceId: string, email: string, role: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, role)
  const cookie = await createDirectSession(userId)
  return cookieAgent(cookie)
}

describe('activity log', () => {
  it('lists entries scoped to this conference, newest first, after a tracked change', async () => {
    const conferenceId = await createConference()
    const agent = await loginAs(conferenceId, 'audit-conv@example.com', 'convenor')

    const create = await agent.post(`/api/conferences/${conferenceId}/tracks`).send({ name: 'A Tracked Track' })
    expect(create.status).toBe(201)

    const res = await agent.get(`/api/conferences/${conferenceId}/activity-log`)
    expect(res.status).toBe(200)
    expect(res.body.entries.some((e: { action: string }) => e.action === 'track.create')).toBe(true)
  })

  it('filters by action', async () => {
    const conferenceId = await createConference()
    const agent = await loginAs(conferenceId, 'audit-conv2@example.com', 'convenor')
    await agent.post(`/api/conferences/${conferenceId}/tracks`).send({ name: 'Another Track' })

    const res = await agent.get(`/api/conferences/${conferenceId}/activity-log`).query({ action: 'track.create' })
    expect(res.status).toBe(200)
    expect(res.body.entries.every((e: { action: string }) => e.action === 'track.create')).toBe(true)
  })

  it('is forbidden for a manager (audit.read is convenor-only)', async () => {
    const conferenceId = await createConference()
    const agent = await loginAs(conferenceId, 'audit-manager@example.com', 'manager')
    const res = await agent.get(`/api/conferences/${conferenceId}/activity-log`)
    expect(res.status).toBe(403)
  })
})
