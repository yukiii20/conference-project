import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { conferenceEndsAt, isConferenceEnded } from '../src/utils/conferenceEnded.js'
import {
  addConferenceMember,
  addSubmissionAuthor,
  createConference,
  createDirectSession,
  createReviewAssignment,
  createSubmission,
  createTrack,
  createUser,
  resetDatabase,
  setDeadlineWindow,
  upsertConferenceSettings,
} from './helpers.js'

/** changes-nov2, Part 2: participant actions are refused once the conference has ended (Nepal time). */
const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function agentFor(conferenceId: string, email: string, role: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, role)
  const cookie = await createDirectSession(userId, conferenceId)
  const with_ = (r: request.Test) => r.set('Cookie', cookie)
  return {
    userId,
    get: (url: string) => with_(request(app).get(url)),
    post: (url: string) => with_(request(app).post(url)),
    put: (url: string) => with_(request(app).put(url)),
    patch: (url: string) => with_(request(app).patch(url)),
    del: (url: string) => with_(request(app).delete(url)),
  }
}

async function endConference(conferenceId: string) {
  await pool.query(
    `UPDATE conferences SET start_date = DATE_SUB(CURDATE(), INTERVAL 5 DAY), end_date = DATE_SUB(CURDATE(), INTERVAL 2 DAY) WHERE id = ?`,
    [conferenceId],
  )
}

function expectEnded(res: request.Response) {
  expect(res.status).toBe(409)
  expect(res.body.error.code).toBe('conference_ended')
  expect(res.body.error.message).toMatch(/This conference has ended/)
}

describe('conferenceEndsAt / isConferenceEnded', () => {
  it('ends at midnight Nepal time after the end date', () => {
    expect(conferenceEndsAt('2026-11-19').toISOString()).toBe('2026-11-19T18:15:00.000Z')
    expect(isConferenceEnded('2026-11-19', new Date('2026-11-19T18:14:59Z'))).toBe(false)
    expect(isConferenceEnded('2026-11-19', new Date('2026-11-19T18:15:00Z'))).toBe(true)
  })
})

describe('ended conference: blocked participant actions', () => {
  it('refuses registering and cancelling a registration', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId, { registration_requires_payment: false })
    await setDeadlineWindow(conferenceId, 'registration', -24, 24)
    const attendee = await agentFor(conferenceId, 'ended-reg@example.com', 'attendee')
    const cats = await attendee.get(`/api/conferences/${conferenceId}/registration-categories`)
    const categoryId = cats.body.categories[0].id as string
    expect((await attendee.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })).status).toBe(201)

    await endConference(conferenceId)
    expectEnded(await attendee.del(`/api/conferences/${conferenceId}/my-registration`))
    const other = await agentFor(conferenceId, 'ended-reg2@example.com', 'attendee')
    expectEnded(await other.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId }))
    // Viewing the ticket still works.
    expect((await attendee.get(`/api/conferences/${conferenceId}/my-registration`)).status).toBe(200)
  })

  it('refuses new abstracts and edits, and reports every author action as unavailable', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await setDeadlineWindow(conferenceId, 'abstract_submission', -24, 24)
    const author = await agentFor(conferenceId, 'ended-author@example.com', 'author')
    const submissionId = await createSubmission(conferenceId, trackId, author.userId, { status: 'draft', title: 'Ended draft paper' })
    await addSubmissionAuthor(submissionId, { fullName: 'Ended Author', email: 'ended-author@example.com', userId: author.userId })

    await endConference(conferenceId)
    expectEnded(
      await author.post(`/api/conferences/${conferenceId}/submissions`).send({
        track_id: trackId,
        title: 'A brand new abstract',
        abstract: 'Too late.',
        keywords: [],
        presentation_preference: 'oral',
      }),
    )
    expectEnded(await author.patch(`/api/submissions/${submissionId}`).send({ title: 'Edited after the end' }))
    expectEnded(await author.post(`/api/submissions/${submissionId}/submit`))
    expectEnded(await author.post(`/api/submissions/${submissionId}/files/abstract`).attach('file', Buffer.from('%PDF-1.4\n'), 'a.pdf'))

    const detail = await author.get(`/api/submissions/${submissionId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.can_edit).toBe(false)
    expect(detail.body.can_delete).toBe(false)
    expect(detail.body.can_upload).toEqual({ abstract: false, full_paper: false, slides: false, camera_ready: false })

    const form = await author.get(`/api/conferences/${conferenceId}/author-form`)
    expect(form.body.windows.abstract_submission.is_open).toBe(false)
  })

  it('refuses reviewer actions', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track R')
    const authorId = await createUser({ email: 'ended-rev-author@example.com', password: 'Str0ng!Pass' })
    const submissionId = await createSubmission(conferenceId, trackId, authorId, { status: 'under_review', title: 'Paper under review' })
    const reviewer = await agentFor(conferenceId, 'ended-reviewer@example.com', 'reviewer')
    const assignmentId = await createReviewAssignment(conferenceId, submissionId, reviewer.userId)

    await endConference(conferenceId)
    expectEnded(await reviewer.post(`/api/reviewer/assignments/${assignmentId}/accept`))
    expectEnded(await reviewer.put(`/api/reviewer/bids/${submissionId}`).send({ preference: 'want' }))
  })

  it('refuses check-in at the desk', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId, { registration_requires_payment: false })
    await setDeadlineWindow(conferenceId, 'registration', -24, 24)
    const attendee = await agentFor(conferenceId, 'ended-checkin@example.com', 'attendee')
    const cats = await attendee.get(`/api/conferences/${conferenceId}/registration-categories`)
    const reg = await attendee.post(`/api/conferences/${conferenceId}/register`).send({ category_id: cats.body.categories[0].id })
    const staff = await agentFor(conferenceId, 'ended-staff@example.com', 'staff')

    await endConference(conferenceId)
    expectEnded(await staff.post(`/api/conferences/${conferenceId}/checkin/manual`).send({ registration_id: reg.body.id }))
  })
})

describe('ended conference: organiser tools keep working', () => {
  it('convenor can still read registrations, reports and announcements', async () => {
    const conferenceId = await createConference()
    const convenor = await agentFor(conferenceId, 'ended-convenor@example.com', 'convenor')
    await endConference(conferenceId)
    expect((await convenor.get(`/api/conferences/${conferenceId}/registrations`)).status).toBe(200)
    expect((await convenor.get(`/api/conferences/${conferenceId}/registrations/export.csv`)).status).toBe(200)
    const announcement = await convenor
      .post(`/api/conferences/${conferenceId}/announcements`)
      .send({ title: 'Thank you for coming', body: 'Slides are online.', audience: ['all'], status: 'published' })
    expect(announcement.status).toBeLessThan(300)
  })
})
