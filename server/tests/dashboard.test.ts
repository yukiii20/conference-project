import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  createConference,
  createDirectSession,
  createTrack,
  createUser,
  resetDatabase,
  upsertConferenceSettings,
} from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

function cookieAgent(cookie: string) {
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    put: (url: string) => request(app).put(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAs(conferenceId: string, email: string, role: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, role)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

describe('convenor dashboard', () => {
  it('returns submission/review/member counts and a track breakdown', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    await createTrack(conferenceId, 'AI')
    const { agent } = await loginAs(conferenceId, 'dash-convenor@example.com', 'convenor')

    const res = await agent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(res.status).toBe(200)
    expect(res.body.submissions_by_status).toBeTypeOf('object')
    expect(res.body.reviews).toEqual({ assigned: 0, completed: 0 })
    expect(res.body.members_by_role.convenor).toBe(1)
    expect(res.body.registrations).toBe(0)
    expect(Array.isArray(res.body.submissions_per_track)).toBe(true)
    expect(res.body.submissions_per_track[0]).toMatchObject({ track_name: 'AI', count: 0 })
    expect(res.body.needs_attention.pending_role_requests).toBe(0)
  })

  it('is forbidden for an author (no conference.view_internal permission)', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'dash-author@example.com', 'author')

    const res = await agent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(res.status).toBe(403)
  })

  it('is forbidden for a member of a different conference', async () => {
    const conferenceId = await createConference()
    const otherConferenceId = await createConference({ slug: 'other-conf-dash' })
    const { agent } = await loginAs(otherConferenceId, 'dash-other@example.com', 'convenor')

    const res = await agent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(res.status).toBe(403)
  })
})
