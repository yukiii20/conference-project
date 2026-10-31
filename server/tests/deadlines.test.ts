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

const ALL_TYPES = [
  'registration',
  'abstract_submission',
  'review',
  'acceptance_notification',
  'full_paper',
  'final_paper',
  'certificate_release',
] as const

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const agent = request.agent(app)
  const login = await agent.post('/api/auth/login').send({ email, password: 'Str0ng!Pass', role: 'convenor', conference: conferenceId })
  expect(login.status).toBe(200)
  return agent
}

function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString()
}

describe('GET /api/conferences/:id/deadlines', () => {
  it('lists all 7 deadline types even before any have been set', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'deadlines-list@example.com')

    const res = await agent.get(`/api/conferences/${conferenceId}/deadlines`)
    expect(res.status).toBe(200)
    expect(res.body.deadlines).toHaveLength(7)
    const codes = (res.body.deadlines as Array<{ code: string }>).map((d) => d.code).sort()
    expect(codes).toEqual([...ALL_TYPES].sort())
  })
})

describe('PUT /api/conferences/:id/deadlines', () => {
  it('saves all 7 types in one call, including a single-date type with closes_at null', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'deadlines-save@example.com')

    const deadlines = ALL_TYPES.map((type, i) => ({
      deadline_type: type,
      opens_at: iso(i),
      closes_at: type === 'acceptance_notification' ? null : iso(i + 5),
      is_public: true,
    }))

    const res = await agent.put(`/api/conferences/${conferenceId}/deadlines`).send({ deadlines })
    expect(res.status).toBe(200)

    const [rows] = await pool.query(
      'SELECT deadline_type, closes_at FROM conference_deadlines WHERE conference_id = ?',
      [conferenceId],
    )
    const byType = Object.fromEntries(
      (rows as Array<{ deadline_type: string; closes_at: string | null }>).map((r) => [r.deadline_type, r.closes_at]),
    )
    expect(byType.acceptance_notification).toBeNull()
    expect(byType.registration).not.toBeNull()
  })

  it('rejects a window whose closes_at is before its opens_at', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'deadlines-badrange@example.com')

    const res = await agent.put(`/api/conferences/${conferenceId}/deadlines`).send({
      deadlines: [{ deadline_type: 'registration', opens_at: iso(10), closes_at: iso(5), is_public: true }],
    })
    expect(res.status).toBe(400)
  })

  it('GET returns real booleans (not 0/1), and saving twice in a row with that exact round-tripped value succeeds', async () => {
    // Regression test: mysql2 returns TINYINT(1) as a number, and
    // is_public from GET used to flow straight back into the next PUT
    // unchanged whenever the convenor didn't touch the checkbox — sending
    // `is_public: 1` instead of `true` and failing updateDeadlinesSchema's
    // strict z.boolean() on every save after the first.
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'deadlines-roundtrip@example.com')

    const first = await agent.put(`/api/conferences/${conferenceId}/deadlines`).send({
      deadlines: [{ deadline_type: 'registration', opens_at: iso(0), closes_at: iso(10), is_public: true }],
    })
    expect(first.status).toBe(200)

    const got = await agent.get(`/api/conferences/${conferenceId}/deadlines`)
    expect(got.status).toBe(200)
    const row = (got.body.deadlines as Array<{ code: string; is_public: unknown; is_window: unknown }>).find(
      (d) => d.code === 'registration',
    )!
    expect(typeof row.is_public).toBe('boolean')
    expect(typeof row.is_window).toBe('boolean')

    const second = await agent.put(`/api/conferences/${conferenceId}/deadlines`).send({
      deadlines: [{ deadline_type: 'registration', opens_at: iso(0), closes_at: iso(10), is_public: row.is_public }],
    })
    expect(second.status).toBe(200)
  })

  it('is forbidden for a non-convenor', async () => {
    const conferenceId = await createConference()
    const res = await request(app)
      .put(`/api/conferences/${conferenceId}/deadlines`)
      .send({ deadlines: [{ deadline_type: 'registration', opens_at: iso(0), closes_at: iso(5), is_public: true }] })
    expect(res.status).toBe(401)
  })
})

describe('is_public hides a deadline from the public API', () => {
  it('a private deadline does not appear on GET /api/conferences/:slug', async () => {
    const conferenceId = await createConference({ status: 'submission_open' })
    const [slugRows] = await pool.query('SELECT slug FROM conferences WHERE id = ?', [conferenceId])
    const slug = (slugRows as Array<{ slug: string }>)[0]!.slug
    const agent = await loginAsConvenor(conferenceId, 'deadlines-public@example.com')

    await agent.put(`/api/conferences/${conferenceId}/deadlines`).send({
      deadlines: [
        { deadline_type: 'registration', opens_at: iso(0), closes_at: iso(10), is_public: true },
        { deadline_type: 'review', opens_at: iso(0), closes_at: iso(10), is_public: false },
      ],
    })

    const res = await request(app).get(`/api/conferences/${slug}`)
    expect(res.status).toBe(200)
    const types = (res.body.deadlines as Array<{ deadline_type: string }>).map((d) => d.deadline_type)
    expect(types).toContain('registration')
    expect(types).not.toContain('review')
  })
})
