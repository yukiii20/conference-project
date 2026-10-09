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
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const cookie = await createDirectSession(userId)
  return cookieAgent(cookie)
}

describe('speakers', () => {
  it('creates, reorders, and deletes a speaker', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'speakers-conv@example.com')

    const create = await agent.post(`/api/conferences/${conferenceId}/speakers`).send({
      full_name: 'Dr Keynote',
      speaker_type: 'keynote',
      is_public: true,
    })
    expect(create.status).toBe(201)
    const speakerId = create.body.id

    const list = await agent.get(`/api/conferences/${conferenceId}/speakers`)
    expect(list.body.speakers).toHaveLength(1)

    const del = await agent.delete(`/api/conferences/${conferenceId}/speakers/${speakerId}`)
    expect(del.status).toBe(200)

    const [rows] = await pool.query('SELECT 1 FROM conference_speakers WHERE id = ?', [speakerId])
    expect((rows as unknown[]).length).toBe(0)
  })

  it('rejects a name shorter than 2 characters', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'speakers-conv2@example.com')
    const res = await agent.post(`/api/conferences/${conferenceId}/speakers`).send({ full_name: 'A' })
    expect(res.status).toBe(400)
  })

  it('is forbidden for an author', async () => {
    const conferenceId = await createConference()
    const authorId = await createUser({ email: 'speakers-author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, authorId, 'author')
    const cookie = await createDirectSession(authorId)
    const agent = cookieAgent(cookie)

    const res = await agent.post(`/api/conferences/${conferenceId}/speakers`).send({ full_name: 'Should Not Work' })
    expect(res.status).toBe(403)
  })
})
