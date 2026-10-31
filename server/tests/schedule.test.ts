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
  const login = await agent.post('/api/auth/login').send({ email, password: 'Str0ng!Pass', role: 'convenor', conference: conferenceId })
  expect(login.status).toBe(200)
  return agent
}

describe('session scheduling', () => {
  it('shows the room-clash trigger message verbatim when two sessions overlap in the same room', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'schedule@example.com')

    const roomRes = await agent.post(`/api/conferences/${conferenceId}/rooms`).send({ name: 'Hall A' })
    expect(roomRes.status).toBe(201)
    const roomId = roomRes.body.id

    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000)
    const overlapStart = new Date(startsAt.getTime() + 30 * 60 * 1000)
    const overlapEnd = new Date(overlapStart.getTime() + 60 * 60 * 1000)

    const firstSession = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Opening Keynote',
      session_type: 'keynote',
      track_id: null,
      room_id: roomId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'draft',
    })
    expect(firstSession.status).toBe(201)

    const secondSession = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Overlapping Talk',
      session_type: 'paper',
      track_id: null,
      room_id: roomId,
      starts_at: overlapStart.toISOString(),
      ends_at: overlapEnd.toISOString(),
      status: 'draft',
    })
    expect(secondSession.status).toBe(400)
    expect(secondSession.body.error.message).toBe('This room already has a session at that time.')
  })

  it('refuses a session scheduled outside the conference dates', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'schedule2@example.com')

    const roomRes = await agent.post(`/api/conferences/${conferenceId}/rooms`).send({ name: 'Hall B' })
    const roomId = roomRes.body.id

    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const farFutureEnd = new Date(farFuture.getTime() + 60 * 60 * 1000)

    const res = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Out of range talk',
      session_type: 'paper',
      track_id: null,
      room_id: roomId,
      starts_at: farFuture.toISOString(),
      ends_at: farFutureEnd.toISOString(),
      status: 'draft',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/conference dates/i)
  })
})
