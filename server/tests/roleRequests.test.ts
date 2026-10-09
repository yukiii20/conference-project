import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createRoleRequest, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function loginAs(email: string, password: string, role: string) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/login').send({ email, password, role })
  expect(res.status).toBe(200)
  return agent
}

describe('GET /api/auth/me conference selector data', () => {
  it("includes conference_slug for each conference-scoped role, so the frontend never needs a separate Supabase lookup", async () => {
    const conferenceId = await createConference()
    const convenorId = await createUser({ email: 'slug-convenor@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenorId, 'convenor')

    const [rows] = await pool.query('SELECT slug FROM conferences WHERE id = ?', [conferenceId])
    const expectedSlug = (rows as Array<{ slug: string }>)[0]!.slug

    const agent = await loginAs('slug-convenor@example.com', 'Str0ng!Pass', 'convenor')
    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)

    const role = (me.body.roles as Array<Record<string, unknown>>).find(
      (r) => r.role_code === 'convenor' && r.conference_id === conferenceId,
    )
    expect(role?.conference_slug).toBe(expectedSlug)
  })
})

describe('role request authorization', () => {
  it('refuses a reviewer calling the approve endpoint', async () => {
    const conferenceId = await createConference()
    const authorId = await createUser({ email: 'author@example.com', password: 'Str0ng!Pass' })
    const reviewerId = await createUser({ email: 'reviewer@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewerId, 'reviewer')
    await createRoleRequest(reviewerId, conferenceId, 'reviewer', 'approved')
    const requestId = await createRoleRequest(authorId, conferenceId, 'author')

    const reviewerAgent = await loginAs('reviewer@example.com', 'Str0ng!Pass', 'reviewer')
    const res = await reviewerAgent.post(`/api/role-requests/${requestId}/approve`)
    expect(res.status).toBe(403)
  })

  it('refuses a convenor of conference A approving a request on conference B', async () => {
    const conferenceA = await createConference()
    const conferenceB = await createConference()

    const convenorAId = await createUser({ email: 'convenor-a@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceA, convenorAId, 'convenor')

    const applicantId = await createUser({ email: 'applicant@example.com', password: 'Str0ng!Pass' })
    const requestId = await createRoleRequest(applicantId, conferenceB, 'author')

    const convenorAAgent = await loginAs('convenor-a@example.com', 'Str0ng!Pass', 'convenor')
    const res = await convenorAAgent.post(`/api/role-requests/${requestId}/approve`)
    expect(res.status).toBe(403)
  })

  it('lets the conference list endpoint be read only by that conference\'s convenor or an admin', async () => {
    const conferenceId = await createConference()
    const staffId = await createUser({ email: 'staff@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, staffId, 'staff')
    await createRoleRequest(staffId, conferenceId, 'staff', 'approved')

    const staffAgent = await loginAs('staff@example.com', 'Str0ng!Pass', 'staff')
    const res = await staffAgent.get(`/api/conferences/${conferenceId}/role-requests`)
    expect(res.status).toBe(403)
  })
})
