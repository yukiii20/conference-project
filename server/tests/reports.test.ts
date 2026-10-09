import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { canReadAllReviews } from '../src/modules/reports/service.js'
import { addConferenceMember, createConference, createDirectSession, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

function cookieAgent(cookie: string) {
  return { get: (url: string) => request(app).get(url).set('Cookie', cookie) }
}

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const cookie = await createDirectSession(userId)
  return cookieAgent(cookie)
}

describe('reports and export', () => {
  it('downloads a submissions CSV with a header row', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'reports-conv@example.com')

    const res = await agent.get(`/api/conferences/${conferenceId}/reports/submissions/csv`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.text.split('\n')[0]).toContain('Code')
  })

  it('downloads a members xlsx workbook', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'reports-conv2@example.com')

    const res = await agent.get(`/api/conferences/${conferenceId}/reports/members/xlsx`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
  })

  it('rejects an unknown report kind', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'reports-conv3@example.com')
    const res = await agent.get(`/api/conferences/${conferenceId}/reports/not-a-report/csv`)
    expect(res.status).toBe(400)
  })

  it('is forbidden for an author', async () => {
    const conferenceId = await createConference()
    const authorId = await createUser({ email: 'reports-author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, authorId, 'author')
    const cookie = await createDirectSession(authorId)
    const agent = cookieAgent(cookie)

    const res = await agent.get(`/api/conferences/${conferenceId}/reports/submissions/csv`)
    expect(res.status).toBe(403)
  })

  it('canReadAllReviews is true for a convenor and false for a reviewer (confidential comments stay hidden without review.read_all)', async () => {
    const conferenceId = await createConference()
    const convenorId = await createUser({ email: 'reports-crar-convenor@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenorId, 'convenor')
    const reviewerId = await createUser({ email: 'reports-crar-reviewer@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewerId, 'reviewer')

    expect(await canReadAllReviews(convenorId, conferenceId)).toBe(true)
    expect(await canReadAllReviews(reviewerId, conferenceId)).toBe(false)
  })
})
