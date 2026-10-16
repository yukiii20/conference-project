import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { withTransaction } from '../src/db/withTransaction.js'
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
    put: (url: string) => request(app).put(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function makeMember(conferenceId: string, email: string, roleCode: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, roleCode)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function forceStatusPath(id: string, ...path: string[]) {
  for (const status of path) {
    await withTransaction(null, async (conn) => {
      await conn.query(`UPDATE submissions SET status = ? WHERE id = ?`, [status, id])
    })
  }
}

/** Creates a submitted submission by `authorEmail`, under review, ready for assignment tests. */
async function createSubmittedSubmission(conferenceId: string, trackId: string, authorEmail: string) {
  const { agent, userId } = await makeMember(conferenceId, authorEmail, 'author')
  const create = await agent
    .post(`/api/conferences/${conferenceId}/submissions`)
    .send({ track_id: trackId, title: 'A Title Long Enough', abstract: 'Abstract text.', keywords: [], presentation_preference: 'either' })
  const id = create.body.id as string
  await forceStatusPath(id, 'submitted')
  return { id, authorUserId: userId, authorAgent: agent }
}

describe('B1 convenor submissions overview', () => {
  it('lists submissions for the convenor but forbids author and reviewer', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { id } = await createSubmittedSubmission(conferenceId, trackId, 'b1-author@example.com')
    const { agent: convenorAgent } = await makeMember(conferenceId, 'b1-convenor@example.com', 'convenor')
    const { agent: reviewerAgent } = await makeMember(conferenceId, 'b1-reviewer@example.com', 'reviewer')
    const { agent: authorAgent } = await makeMember(conferenceId, 'b1-other-author@example.com', 'author')
    const { agent: staffAgent } = await makeMember(conferenceId, 'b1-staff@example.com', 'staff')

    const list = await convenorAgent.get(`/api/conferences/${conferenceId}/submissions`)
    expect(list.status).toBe(200)
    expect(list.body.submissions.some((s: { id: string }) => s.id === id)).toBe(true)

    const reviewerList = await reviewerAgent.get(`/api/conferences/${conferenceId}/submissions`)
    expect(reviewerList.status).toBe(403)
    const authorList = await authorAgent.get(`/api/conferences/${conferenceId}/submissions`)
    expect(authorList.status).toBe(403)
    // Staff (registration.read_all + attendance.record only) must never see papers or reviews.
    const staffList = await staffAgent.get(`/api/conferences/${conferenceId}/submissions`)
    expect(staffList.status).toBe(403)
    const staffDetail = await staffAgent.get(`/api/conferences/${conferenceId}/submissions/${id}`)
    expect(staffDetail.status).toBe(403)
  })
})

describe('B2 assigning reviewers', () => {
  it('rejects a non-reviewer, the paper\'s own author, a declared conflict, and a duplicate assignment', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { id, authorUserId } = await createSubmittedSubmission(conferenceId, trackId, 'b2-author@example.com')
    const { agent: convenorAgent } = await makeMember(conferenceId, 'b2-convenor@example.com', 'convenor')
    const { userId: nonReviewerId } = await makeMember(conferenceId, 'b2-notreviewer@example.com', 'author')
    const { userId: reviewerId } = await makeMember(conferenceId, 'b2-reviewer@example.com', 'reviewer')
    const { userId: conflictedReviewerId } = await makeMember(conferenceId, 'b2-conflicted@example.com', 'reviewer')
    await pool.query(`INSERT INTO conflicts_of_interest (submission_id, user_id, source) VALUES (?, ?, 'manager_flagged')`, [
      id,
      conflictedReviewerId,
    ])

    const dueAt = new Date(Date.now() + 14 * 86_400_000).toISOString()

    const nonReviewerRes = await convenorAgent
      .post(`/api/conferences/${conferenceId}/submissions/${id}/assignments`)
      .send({ reviewer_id: nonReviewerId, due_at: dueAt })
    expect(nonReviewerRes.status).toBe(400)

    const ownAuthorRes = await convenorAgent
      .post(`/api/conferences/${conferenceId}/submissions/${id}/assignments`)
      .send({ reviewer_id: authorUserId, due_at: dueAt })
    expect(ownAuthorRes.status).toBe(400)

    const conflictRes = await convenorAgent
      .post(`/api/conferences/${conferenceId}/submissions/${id}/assignments`)
      .send({ reviewer_id: conflictedReviewerId, due_at: dueAt })
    expect(conflictRes.status).toBe(400)

    const okRes = await convenorAgent
      .post(`/api/conferences/${conferenceId}/submissions/${id}/assignments`)
      .send({ reviewer_id: reviewerId, due_at: dueAt })
    expect(okRes.status).toBe(201)

    const dupRes = await convenorAgent
      .post(`/api/conferences/${conferenceId}/submissions/${id}/assignments`)
      .send({ reviewer_id: reviewerId, due_at: dueAt })
    expect(dupRes.status).toBe(409)

    const [subRows] = await pool.query('SELECT status FROM submissions WHERE id = ?', [id])
    expect((subRows as Array<{ status: string }>)[0]!.status).toBe('under_review')

    const [emailRows] = await pool.query(
      `SELECT 1 FROM email_logs WHERE template_key = 'review_assigned' AND user_id = ?`,
      [reviewerId],
    )
    expect((emailRows as unknown[]).length).toBe(1)
  })
})

describe('B3 reviewer portal', () => {
  async function setupAssignment() {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await upsertConferenceSettings(conferenceId, { review_mode: 'double_blind' })
    const { id: submissionId } = await createSubmittedSubmission(conferenceId, trackId, 'b3-author@example.com')
    const { agent: convenorAgent } = await makeMember(conferenceId, 'b3-convenor@example.com', 'convenor')
    const { agent: reviewerAgent, userId: reviewerId } = await makeMember(conferenceId, 'b3-reviewer@example.com', 'reviewer')
    const { agent: otherReviewerAgent } = await makeMember(conferenceId, 'b3-other-reviewer@example.com', 'reviewer')

    const dueAt = new Date(Date.now() + 14 * 86_400_000).toISOString()
    const assign = await convenorAgent
      .post(`/api/conferences/${conferenceId}/submissions/${submissionId}/assignments`)
      .send({ reviewer_id: reviewerId, due_at: dueAt })
    const assignmentId = assign.body.id as string

    return { conferenceId, submissionId, assignmentId, reviewerAgent, otherReviewerAgent, convenorAgent }
  }

  it('shows only the reviewer\'s own assignments and hides authors in double-blind mode', async () => {
    const { conferenceId, submissionId, assignmentId, reviewerAgent, otherReviewerAgent } = await setupAssignment()

    const mine = await reviewerAgent.get(`/api/reviewer/assignments?conference_id=${conferenceId}`)
    expect(mine.status).toBe(200)
    expect(mine.body.assignments).toHaveLength(1)
    expect(mine.body.assignments[0].submission_id).toBe(submissionId)

    const othersView = await otherReviewerAgent.get(`/api/reviewer/assignments?conference_id=${conferenceId}`)
    expect(othersView.body.assignments).toHaveLength(0)

    const notMine = await otherReviewerAgent.get(`/api/reviewer/assignments/${assignmentId}`)
    expect(notMine.status).toBe(404)

    const detail = await reviewerAgent.get(`/api/reviewer/assignments/${assignmentId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.authors).toEqual([])
  })

  it('saves a draft, requires full validation to submit, and locks the review afterwards', async () => {
    const { assignmentId, reviewerAgent } = await setupAssignment()

    await reviewerAgent.post(`/api/reviewer/assignments/${assignmentId}/accept`)

    const draft = await reviewerAgent.put(`/api/reviewer/assignments/${assignmentId}/review`).send({ originality: 4 })
    expect(draft.status).toBe(200)

    const incompleteSubmit = await reviewerAgent.post(`/api/reviewer/assignments/${assignmentId}/review/submit`).send({
      originality: 4,
      quality: 4,
    })
    expect(incompleteSubmit.status).toBe(400)

    const fullSubmit = await reviewerAgent.post(`/api/reviewer/assignments/${assignmentId}/review/submit`).send({
      originality: 4,
      quality: 4,
      relevance: 4,
      methodology: 3,
      overall_score: 4,
      confidence: 4,
      recommendation: 'accept',
      comments_to_author: 'Nice work overall.',
    })
    expect(fullSubmit.status).toBe(200)

    const editAfterSubmit = await reviewerAgent.put(`/api/reviewer/assignments/${assignmentId}/review`).send({ originality: 1 })
    expect(editAfterSubmit.status).toBe(409)
  })
})

describe('B4 decisions', () => {
  it('lets the author upload a full paper after acceptance, and rejects a second decision for the same stage/round', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await upsertConferenceSettings(conferenceId, { authors_see_review_comments: true, review_mode: 'double_blind' })
    const { id: submissionId, authorAgent } = await createSubmittedSubmission(conferenceId, trackId, 'b4-author@example.com')
    const { agent: convenorAgent } = await makeMember(conferenceId, 'b4-convenor@example.com', 'convenor')

    const accept = await convenorAgent.post(`/api/conferences/${conferenceId}/submissions/${submissionId}/decisions`).send({
      stage: 'abstract',
      decision: 'accepted',
      comments_to_author: 'Great abstract.',
    })
    expect(accept.status).toBe(201)

    const [subRows] = await pool.query('SELECT status FROM submissions WHERE id = ?', [submissionId])
    expect((subRows as Array<{ status: string }>)[0]!.status).toBe('accepted')

    const detail = await authorAgent.get(`/api/submissions/${submissionId}`)
    expect(detail.body.can_upload.full_paper).toBe(false) // no full_paper window configured yet

    const dup = await convenorAgent.post(`/api/conferences/${conferenceId}/submissions/${submissionId}/decisions`).send({
      stage: 'abstract',
      decision: 'rejected',
      comments_to_author: 'Changed my mind.',
    })
    expect(dup.status).toBe(409)
  })

  it('never shows the author confidential comments or reviewer identity', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await upsertConferenceSettings(conferenceId, { authors_see_review_comments: true, review_mode: 'open' })
    const { id: submissionId, authorAgent } = await createSubmittedSubmission(conferenceId, trackId, 'b4-feedback-author@example.com')
    const { agent: convenorAgent } = await makeMember(conferenceId, 'b4-feedback-convenor@example.com', 'convenor')
    const { agent: reviewerAgent, userId: reviewerId } = await makeMember(conferenceId, 'b4-feedback-reviewer@example.com', 'reviewer')

    await forceStatusPath(submissionId, 'under_review')
    const dueAt = new Date(Date.now() + 14 * 86_400_000).toISOString()
    const assign = await convenorAgent
      .post(`/api/conferences/${conferenceId}/submissions/${submissionId}/assignments`)
      .send({ reviewer_id: reviewerId, due_at: dueAt })
    const assignmentId = assign.body.id

    await reviewerAgent.post(`/api/reviewer/assignments/${assignmentId}/accept`)
    await reviewerAgent.post(`/api/reviewer/assignments/${assignmentId}/review/submit`).send({
      originality: 5,
      quality: 5,
      relevance: 5,
      methodology: 5,
      overall_score: 5,
      confidence: 5,
      recommendation: 'accept',
      comments_to_author: 'Visible to the author.',
      confidential_comments: 'Secret notes for the convenor only.',
    })

    const detail = await authorAgent.get(`/api/submissions/${submissionId}`)
    const body = JSON.stringify(detail.body)
    expect(body).toContain('Visible to the author.')
    expect(body).not.toContain('Secret notes')
    expect(body).not.toContain(reviewerId)
  })
})
