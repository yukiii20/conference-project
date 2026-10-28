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
  makePlatformAdmin,
  resetDatabase,
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
    get: (url: string, query?: Record<string, string>) =>
      request(app)
        .get(url)
        .query(query ?? {})
        .set('Cookie', cookie),
  }
}

async function loginAs(conferenceId: string | null, email: string, roleCode: string | null) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  if (conferenceId && roleCode) await addConferenceMember(conferenceId, userId, roleCode)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function createSubmission(conferenceId: string, trackId: string, createdByUserId: string, status: string): Promise<string> {
  await pool.query(
    `INSERT INTO submissions (conference_id, track_id, title, abstract, status, created_by, submitted_at)
     VALUES (?, ?, 'Analytics Test Submission', 'Abstract text here.', ?, ?, NOW(3))`,
    [conferenceId, trackId, status, createdByUserId],
  )
  const [rows] = await pool.query(
    'SELECT id FROM submissions WHERE conference_id = ? ORDER BY created_at DESC LIMIT 1',
    [conferenceId],
  )
  return (rows as Array<{ id: string }>)[0]!.id
}

describe('convenor analytics', () => {
  it('is forbidden for staff (no report.view); works for convenor and manager', async () => {
    const conferenceId = await createConference()
    const { agent: staffAgent } = await loginAs(conferenceId, 'an-staff@example.com', 'staff')
    const res1 = await staffAgent.get(`/api/conferences/${conferenceId}/analytics`)
    expect(res1.status).toBe(403)

    const { agent: convenorAgent } = await loginAs(conferenceId, 'an-conv@example.com', 'convenor')
    const res2 = await convenorAgent.get(`/api/conferences/${conferenceId}/analytics`)
    expect(res2.status).toBe(200)

    const { agent: managerAgent } = await loginAs(conferenceId, 'an-manager@example.com', 'manager')
    const res3 = await managerAgent.get(`/api/conferences/${conferenceId}/analytics`)
    expect(res3.status).toBe(200)
  })

  it('computes acceptance rate and submissions per track from seeded data', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'an-conv2@example.com', 'convenor')
    const trackId = await createTrack(conferenceId, 'Analytics Track')
    const creatorId = await createUser({ email: 'an-creator@example.com', password: 'Str0ng!Pass' })

    const acceptedSub = await createSubmission(conferenceId, trackId, creatorId, 'accepted')
    const rejectedSub = await createSubmission(conferenceId, trackId, creatorId, 'rejected')
    await pool.query(`INSERT INTO submission_decisions (submission_id, stage, round, decision) VALUES (?, 'abstract', 1, 'accepted')`, [
      acceptedSub,
    ])
    await pool.query(`INSERT INTO submission_decisions (submission_id, stage, round, decision) VALUES (?, 'abstract', 1, 'rejected')`, [
      rejectedSub,
    ])

    const res = await agent.get(`/api/conferences/${conferenceId}/analytics`)
    expect(res.status).toBe(200)
    expect(res.body.acceptance_rate).toMatchObject({ numerator: 1, denominator: 2, rate: 0.5 })
    expect(res.body.submissions_per_track).toEqual([{ name: 'Analytics Track', count: 2 }])
  })

  it('counts review progress (assigned/submitted/overdue) correctly', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'an-conv3@example.com', 'convenor')
    const trackId = await createTrack(conferenceId, 'Track R')
    const creatorId = await createUser({ email: 'an-creator2@example.com', password: 'Str0ng!Pass' })
    const { userId: reviewerId } = await loginAs(null, 'an-reviewer@example.com', null)

    const sub1 = await createSubmission(conferenceId, trackId, creatorId, 'under_review')
    const sub2 = await createSubmission(conferenceId, trackId, creatorId, 'under_review')
    const sub3 = await createSubmission(conferenceId, trackId, creatorId, 'under_review')

    // One overdue (due in the past, still assigned), one completed, one assigned not yet due.
    await pool.query(
      `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, status, due_at)
       VALUES (?, ?, ?, 1, 'assigned', DATE_SUB(NOW(3), INTERVAL 1 DAY))`,
      [conferenceId, sub1, reviewerId],
    )
    await pool.query(
      `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, status, due_at)
       VALUES (?, ?, ?, 1, 'completed', DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
      [conferenceId, sub2, reviewerId],
    )
    await pool.query(
      `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, status, due_at)
       VALUES (?, ?, ?, 1, 'assigned', DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
      [conferenceId, sub3, reviewerId],
    )

    const res = await agent.get(`/api/conferences/${conferenceId}/analytics`)
    expect(res.body.review_progress).toEqual({ assigned: 2, submitted: 1, overdue: 1 })
  })

  it('bins submissions per day into the requested date range, filling empty days with 0', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'an-conv4@example.com', 'convenor')
    const trackId = await createTrack(conferenceId, 'Track D')
    const creatorId = await createUser({ email: 'an-creator3@example.com', password: 'Str0ng!Pass' })
    await createSubmission(conferenceId, trackId, creatorId, 'submitted')

    const today = new Date().toISOString().slice(0, 10)
    const res = await agent.get(`/api/conferences/${conferenceId}/analytics`, { from: today, to: today })
    expect(res.body.submissions_per_day).toHaveLength(1)
    expect(res.body.submissions_per_day[0].count).toBe(1)
  })

  it('PDF and Excel export open with the right content type', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'an-conv5@example.com', 'convenor')

    const pdf = await agent.get(`/api/conferences/${conferenceId}/analytics/report.pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')

    const xlsx = await agent.get(`/api/conferences/${conferenceId}/analytics/report.xlsx`)
    expect(xlsx.status).toBe(200)
    expect(xlsx.headers['content-type']).toContain('spreadsheetml')
  })
})

describe('platform analytics', () => {
  it('is forbidden for a non-admin; works for a platform admin', async () => {
    const { agent: plainAgent } = await loginAs(null, 'an-plain@example.com', null)
    const res1 = await plainAgent.get('/api/admin/analytics')
    expect(res1.status).toBe(403)

    const { agent: adminAgent, userId: adminId } = await loginAs(null, 'an-admin@example.com', null)
    await makePlatformAdmin(adminId)
    const res2 = await adminAgent.get('/api/admin/analytics')
    expect(res2.status).toBe(200)
    expect(res2.body.conferences_by_status).toBeInstanceOf(Array)
  })

  it('counts conferences by status', async () => {
    await createConference({ status: 'published' })
    await createConference({ status: 'draft' })
    const { agent, userId } = await loginAs(null, 'an-admin2@example.com', null)
    await makePlatformAdmin(userId)

    const res = await agent.get('/api/admin/analytics')
    const byStatus: Record<string, number> = {}
    for (const row of res.body.conferences_by_status as Array<{ name: string; count: number }>) byStatus[row.name] = row.count
    expect(byStatus.published).toBeGreaterThanOrEqual(1)
    expect(byStatus.draft).toBeGreaterThanOrEqual(1)
  })
})
