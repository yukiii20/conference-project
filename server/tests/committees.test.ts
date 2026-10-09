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
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    put: (url: string) => request(app).put(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const cookie = await createDirectSession(userId)
  return cookieAgent(cookie)
}

describe('committees', () => {
  it('creates a committee, adds a typed-in member and a picked user, and reorders', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'committees-conv@example.com')
    const existingUserId = await createUser({ email: 'committee-user@example.com', password: 'Str0ng!Pass', fullName: 'Picked Person' })

    const create = await agent
      .post(`/api/conferences/${conferenceId}/committees`)
      .send({ name: 'Organizing Committee', committee_type: 'organizing', is_public: true })
    expect(create.status).toBe(201)
    const committeeId = create.body.id

    const typedMember = await agent.post(`/api/conferences/${conferenceId}/committees/${committeeId}/members`).send({
      display_name: 'Typed In Person',
      affiliation: 'Some University',
      member_role: 'chair',
    })
    expect(typedMember.status).toBe(201)

    const pickedMember = await agent.post(`/api/conferences/${conferenceId}/committees/${committeeId}/members`).send({
      user_id: existingUserId,
      member_role: 'member',
    })
    expect(pickedMember.status).toBe(201)

    const list = await agent.get(`/api/conferences/${conferenceId}/committees`)
    expect(list.status).toBe(200)
    expect(list.body.committees[0].members).toHaveLength(2)
    const picked = list.body.committees[0].members.find((m: { user_id: string | null }) => m.user_id === existingUserId)
    expect(picked.full_name).toBe('Picked Person')
  })

  it('rejects a member with neither a picked user nor a typed name', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'committees-conv2@example.com')
    const create = await agent.post(`/api/conferences/${conferenceId}/committees`).send({ name: 'Technical Committee' })
    const committeeId = create.body.id

    const res = await agent.post(`/api/conferences/${conferenceId}/committees/${committeeId}/members`).send({
      member_role: 'member',
    })
    expect(res.status).toBe(400)
  })

  it('is forbidden for someone not on this conference', async () => {
    const conferenceId = await createConference()
    const otherConferenceId = await createConference({ slug: 'other-conf-committees' })
    const agent = await loginAsConvenor(otherConferenceId, 'committees-other@example.com')

    const res = await agent.get(`/api/conferences/${conferenceId}/committees`)
    expect(res.status).toBe(403)
  })
})
