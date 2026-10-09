import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const agent = request.agent(app)
  const login = await agent.post('/api/auth/login').send({ email, password: 'Str0ng!Pass', role: 'convenor' })
  expect(login.status).toBe(200)
  return agent
}

describe('conference tracks CRUD', () => {
  it('adds, edits, and deactivates a track', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'tracks@example.com')

    const create = await agent
      .post(`/api/conferences/${conferenceId}/tracks`)
      .send({ name: 'AI and Society', code: 'AIS', description: 'Track about AI.' })
    expect(create.status).toBe(201)
    const trackId = create.body.id
    expect(trackId).toBeTruthy()

    const edit = await agent
      .patch(`/api/conferences/${conferenceId}/tracks/${trackId}`)
      .send({ name: 'AI and Society (renamed)' })
    expect(edit.status).toBe(200)

    const [rows] = await pool.query('SELECT name, is_active FROM conference_tracks WHERE id = ?', [trackId])
    const row = (rows as Array<{ name: string; is_active: number }>)[0]!
    expect(row.name).toBe('AI and Society (renamed)')
    expect(Boolean(row.is_active)).toBe(true)

    const deactivate = await agent
      .patch(`/api/conferences/${conferenceId}/tracks/${trackId}/deactivate`)
      .send({ is_active: false })
    expect(deactivate.status).toBe(200)

    const [afterRows] = await pool.query('SELECT is_active FROM conference_tracks WHERE id = ?', [trackId])
    expect(Boolean((afterRows as Array<{ is_active: number }>)[0]!.is_active)).toBe(false)
  })

  it('rejects a track name shorter than 2 characters', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'tracks-bad@example.com')

    const res = await agent.post(`/api/conferences/${conferenceId}/tracks`).send({ name: 'A' })
    expect(res.status).toBe(400)
  })

  it('is forbidden for someone who is not this conference\'s convenor', async () => {
    const conferenceId = await createConference()
    const otherConferenceId = await createConference({ slug: 'other-conf-tracks' })
    const agent = await loginAsConvenor(otherConferenceId, 'tracks-other@example.com')

    const res = await agent.post(`/api/conferences/${conferenceId}/tracks`).send({ name: 'Should not work' })
    expect(res.status).toBe(403)
  })
})
