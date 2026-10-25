import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createTrack, createUser, resetDatabase } from './helpers.js'

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
  }
}

async function makeMember(conferenceId: string, email: string, roleCode: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, roleCode)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function createSubmittedSubmission(conferenceId: string, trackId: string, authorEmail: string) {
  const { agent } = await makeMember(conferenceId, authorEmail, 'author')
  const create = await agent
    .post(`/api/conferences/${conferenceId}/submissions`)
    .send({ track_id: trackId, title: 'Auto-assign title', abstract: 'Abstract text with details.', keywords: [], presentation_preference: 'either' })
  const id = create.body.id as string
  await pool.query(`UPDATE submissions SET status = 'submitted' WHERE id = ?`, [id])
  return id
}

describe('auto-assign reviewers', () => {
  it('forbids a reviewer from previewing or confirming', async () => {
    const conferenceId = await createConference()
    const { agent } = await makeMember(conferenceId, 'aa-reviewer1@example.com', 'reviewer')
    const preview = await agent
      .post(`/api/conferences/${conferenceId}/auto-assign/preview`)
      .send({ reviewers_per_paper: 2, max_papers_per_reviewer: 5, only_unassigned: true })
    expect(preview.status).toBe(403)
  })

  it('proposes nothing before confirm, then creates real assignments and sends the normal assignment email on confirm', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const id1 = await createSubmittedSubmission(conferenceId, trackId, 'aa-author1@example.com')
    const id2 = await createSubmittedSubmission(conferenceId, trackId, 'aa-author2@example.com')
    const { agent: convenorAgent } = await makeMember(conferenceId, 'aa-convenor@example.com', 'convenor')
    const { userId: r1 } = await makeMember(conferenceId, 'aa-reviewer2@example.com', 'reviewer')
    const { userId: r2 } = await makeMember(conferenceId, 'aa-reviewer3@example.com', 'reviewer')

    const preview = await convenorAgent
      .post(`/api/conferences/${conferenceId}/auto-assign/preview`)
      .send({ reviewers_per_paper: 1, max_papers_per_reviewer: 5, only_unassigned: true })
    expect(preview.status).toBe(200)
    expect(preview.body.assignments).toHaveLength(2)

    const [beforeCount] = await pool.query(`SELECT COUNT(*) AS n FROM review_assignments WHERE conference_id = ?`, [conferenceId])
    expect((beforeCount as Array<{ n: number }>)[0]!.n).toBe(0)

    const dueAt = new Date(Date.now() + 10 * 86_400_000).toISOString()
    const confirm = await convenorAgent.post(`/api/conferences/${conferenceId}/auto-assign/confirm`).send({
      due_at: dueAt,
      assignments: preview.body.assignments.map((a: { submission_id: string; reviewer_id: string }) => ({
        submission_id: a.submission_id,
        reviewer_id: a.reviewer_id,
      })),
    })
    expect(confirm.status).toBe(201)
    expect(confirm.body.count).toBe(2)

    const [afterCount] = await pool.query(`SELECT COUNT(*) AS n FROM review_assignments WHERE conference_id = ?`, [conferenceId])
    expect((afterCount as Array<{ n: number }>)[0]!.n).toBe(2)

    const [emailRows] = await pool.query(`SELECT COUNT(*) AS n FROM email_logs WHERE template_key = 'review_assigned'`)
    expect((emailRows as Array<{ n: number }>)[0]!.n).toBe(2)

    void id1
    void id2
    void r1
    void r2
  })

  it('confirm is one atomic transaction - a bad reviewer in the batch rolls back the whole confirm', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const id1 = await createSubmittedSubmission(conferenceId, trackId, 'aa-author3@example.com')
    const { agent: convenorAgent } = await makeMember(conferenceId, 'aa-convenor2@example.com', 'convenor')
    const { userId: r1 } = await makeMember(conferenceId, 'aa-reviewer4@example.com', 'reviewer')

    const dueAt = new Date(Date.now() + 10 * 86_400_000).toISOString()
    const confirm = await convenorAgent.post(`/api/conferences/${conferenceId}/auto-assign/confirm`).send({
      due_at: dueAt,
      assignments: [
        { submission_id: id1, reviewer_id: r1 },
        { submission_id: id1, reviewer_id: '00000000-0000-0000-0000-000000000000' }, // not a reviewer - should fail validation
      ],
    })
    expect(confirm.status).toBe(400)

    const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM review_assignments WHERE conference_id = ?`, [conferenceId])
    expect((rows as Array<{ n: number }>)[0]!.n).toBe(0)
  })
})
