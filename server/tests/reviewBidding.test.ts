import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  addReviewBid,
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
  }
}

async function makeMember(conferenceId: string, email: string, roleCode: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, roleCode)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function createSubmittedSubmission(conferenceId: string, trackId: string, authorEmail: string) {
  const { agent, userId } = await makeMember(conferenceId, authorEmail, 'author')
  const create = await agent
    .post(`/api/conferences/${conferenceId}/submissions`)
    .send({ track_id: trackId, title: 'A Title Long Enough', abstract: 'Abstract text with details.', keywords: [], presentation_preference: 'either' })
  const id = create.body.id as string
  await pool.query(`UPDATE submissions SET status = 'submitted' WHERE id = ?`, [id])
  return { id, authorUserId: userId, authorAgent: agent }
}

function openBiddingWindow(conferenceId: string) {
  return upsertConferenceSettings(conferenceId, {
    bidding_enabled: true,
    bidding_start_at: new Date(Date.now() - 3_600_000),
    bidding_end_at: new Date(Date.now() + 3_600_000),
  })
}

describe('reviewer bidding', () => {
  it('never returns author names, affiliations, or files - only title/track/keywords/abstract', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await createSubmittedSubmission(conferenceId, trackId, 'bid-author@example.com')
    await openBiddingWindow(conferenceId)
    const { agent } = await makeMember(conferenceId, 'bid-reviewer1@example.com', 'reviewer')

    const res = await agent.get(`/api/reviewer/bids?conference_id=${conferenceId}`)
    expect(res.status).toBe(200)
    expect(res.body.submissions).toHaveLength(1)
    const sub = res.body.submissions[0]
    expect(Object.keys(sub).sort()).toEqual(['abstract', 'bid', 'id', 'keywords', 'submission_code', 'title', 'track_id', 'track_name'].sort())
    expect(JSON.stringify(sub)).not.toMatch(/bid-author@example\.com/)
  })

  it('a reviewer cannot bid in a conference they are not a reviewer of', async () => {
    const conferenceId = await createConference()
    const otherConferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { id } = await createSubmittedSubmission(conferenceId, trackId, 'bid-author2@example.com')
    await openBiddingWindow(conferenceId)
    // This user is a reviewer of otherConferenceId, not conferenceId.
    const { agent } = await makeMember(otherConferenceId, 'bid-reviewer2@example.com', 'reviewer')

    const list = await agent.get(`/api/reviewer/bids?conference_id=${conferenceId}`)
    expect(list.status).toBe(403)

    const put = await agent.put(`/api/reviewer/bids/${id}`).send({ preference: 'want' })
    expect(put.status).toBe(403)
  })

  it('bidding is closed outside the configured window', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { id } = await createSubmittedSubmission(conferenceId, trackId, 'bid-author3@example.com')
    await upsertConferenceSettings(conferenceId, { bidding_enabled: false })
    const { agent } = await makeMember(conferenceId, 'bid-reviewer3@example.com', 'reviewer')

    const list = await agent.get(`/api/reviewer/bids?conference_id=${conferenceId}`)
    expect(list.status).toBe(200)
    expect(list.body.bidding_open).toBe(false)

    const put = await agent.put(`/api/reviewer/bids/${id}`).send({ preference: 'want' })
    expect(put.status).toBe(409)
  })

  it('saves instantly, tracks progress, and a declared conflict blocks assignment', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { id: id1 } = await createSubmittedSubmission(conferenceId, trackId, 'bid-author4@example.com')
    const { id: id2 } = await createSubmittedSubmission(conferenceId, trackId, 'bid-author5@example.com')
    await openBiddingWindow(conferenceId)
    const { agent, userId: reviewerId } = await makeMember(conferenceId, 'bid-reviewer4@example.com', 'reviewer')

    const before = await agent.get(`/api/reviewer/bids?conference_id=${conferenceId}`)
    expect(before.body.total_count).toBe(2)
    expect(before.body.bid_count).toBe(0)

    const bid1 = await agent.put(`/api/reviewer/bids/${id1}`).send({ preference: 'want' })
    expect(bid1.status).toBe(200)
    const bid2 = await agent.put(`/api/reviewer/bids/${id2}`).send({ preference: 'conflict' })
    expect(bid2.status).toBe(200)

    const after = await agent.get(`/api/reviewer/bids?conference_id=${conferenceId}`)
    expect(after.body.bid_count).toBe(2)
    expect(after.body.submissions.find((s: { id: string }) => s.id === id1).bid).toBe('want')

    const { agent: convenorAgent } = await makeMember(conferenceId, 'bid-convenor@example.com', 'convenor')
    const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
    const assign = await convenorAgent
      .post(`/api/conferences/${conferenceId}/submissions/${id2}/assignments`)
      .send({ reviewer_id: reviewerId, due_at: dueAt })
    expect(assign.status).toBe(400)
    expect(assign.body.error.message).toMatch(/conflict/i)

    // The other paper (no conflict bid) still assigns fine.
    const assignOk = await convenorAgent
      .post(`/api/conferences/${conferenceId}/submissions/${id1}/assignments`)
      .send({ reviewer_id: reviewerId, due_at: dueAt })
    expect(assignOk.status).toBe(201)
  })

  it('cannot bid on your own submission', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { id, authorAgent, authorUserId } = await createSubmittedSubmission(conferenceId, trackId, 'bid-self@example.com')
    await openBiddingWindow(conferenceId)
    await addConferenceMember(conferenceId, authorUserId, 'reviewer')

    const res = await authorAgent.put(`/api/reviewer/bids/${id}`).send({ preference: 'want' })
    expect(res.status).toBe(400)
  })
})
