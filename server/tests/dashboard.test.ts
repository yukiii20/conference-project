import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  createConference,
  createDirectSession,
  createSubmission,
  createTrack,
  createUser,
  resetDatabase,
  setDeadlineWindow,
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
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    put: (url: string) => request(app).put(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAs(conferenceId: string, email: string, role: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, role)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

describe('convenor dashboard', () => {
  it('returns submission/review/member counts and a track breakdown', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    await createTrack(conferenceId, 'AI')
    const { agent } = await loginAs(conferenceId, 'dash-convenor@example.com', 'convenor')

    const res = await agent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(res.status).toBe(200)
    expect(res.body.submissions_by_status).toBeTypeOf('object')
    expect(res.body.reviews).toEqual({ assigned: 0, completed: 0 })
    expect(res.body.members_by_role.convenor).toBe(1)
    expect(res.body.registrations).toBe(0)
    expect(Array.isArray(res.body.submissions_per_track)).toBe(true)
    expect(res.body.submissions_per_track[0]).toMatchObject({ track_name: 'AI', count: 0 })
    expect(res.body.needs_attention.pending_role_requests).toBe(0)
  })

  it('counts reviews pending (assigned/in_progress) separately from reviews done (completed) - not a shared bucket', async () => {
    // Regression guard for the "Reviews pending" stat card (Step 7B+C, docs/finish-7bc-theme-and-ui.md
    // B3): pending must be assigned-but-not-yet-submitted, done must be submitted (completed), and the
    // two counts must come out different when the underlying rows differ - not just both read as 0.
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const trackId = await createTrack(conferenceId, 'Networks')
    const { agent } = await loginAs(conferenceId, 'dash-convenor3@example.com', 'convenor')
    const authorId = await createUser({ email: 'dash-author3@example.com', password: 'Str0ng!Pass' })
    const reviewer1 = await createUser({ email: 'dash-reviewer1@example.com', password: 'Str0ng!Pass' })
    const reviewer2 = await createUser({ email: 'dash-reviewer2@example.com', password: 'Str0ng!Pass' })
    const reviewer3 = await createUser({ email: 'dash-reviewer3@example.com', password: 'Str0ng!Pass' })

    const sub1 = await createSubmission(conferenceId, trackId, authorId, { title: 'Paper One', status: 'under_review' })
    const sub2 = await createSubmission(conferenceId, trackId, authorId, { title: 'Paper Two', status: 'under_review' })
    const sub3 = await createSubmission(conferenceId, trackId, authorId, { title: 'Paper Three', status: 'under_review' })

    await pool.query(
      `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, status, due_at)
       VALUES (?, ?, ?, 1, 'assigned', DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
      [conferenceId, sub1, reviewer1],
    )
    await pool.query(
      `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, status, due_at)
       VALUES (?, ?, ?, 1, 'in_progress', DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
      [conferenceId, sub2, reviewer2],
    )
    await pool.query(
      `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, status, due_at, completed_at)
       VALUES (?, ?, ?, 1, 'completed', DATE_ADD(NOW(3), INTERVAL 7 DAY), NOW(3))`,
      [conferenceId, sub3, reviewer3],
    )

    const res = await agent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(res.status).toBe(200)
    expect(res.body.reviews).toEqual({ assigned: 2, completed: 1 })
  })

  it('counts real registrations, excluding cancelled ones - not a hard-coded 0', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId, { registration_requires_payment: false })
    await setDeadlineWindow(conferenceId, 'registration', -24, 24)
    await pool.query(`INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General')`, [
      conferenceId,
    ])
    const [[{ id: categoryId }]] = (await pool.query(
      'SELECT id FROM registration_categories WHERE conference_id = ? AND code = ?',
      [conferenceId, 'general'],
    )) as unknown as [Array<{ id: string }>]

    const { agent: convenorAgent } = await loginAs(conferenceId, 'dash-convenor2@example.com', 'convenor')
    const { agent: attendeeAgent } = await loginAs(conferenceId, 'dash-attendee@example.com', 'author')
    const { agent: cancelledAgent } = await loginAs(conferenceId, 'dash-cancelled@example.com', 'author')

    const reg = await attendeeAgent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(reg.status).toBe(201)

    const cancelledReg = await cancelledAgent
      .post(`/api/conferences/${conferenceId}/register`)
      .send({ category_id: categoryId })
    expect(cancelledReg.status).toBe(201)
    const cancel = await cancelledAgent.delete(`/api/conferences/${conferenceId}/my-registration`)
    expect(cancel.status).toBe(200)

    const res = await convenorAgent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(res.status).toBe(200)
    expect(res.body.registrations).toBe(1)
  })

  it('reports an accurate setup checklist that flips to done as each step is completed', async () => {
    const conferenceId = await createConference({ status: 'draft' })
    await upsertConferenceSettings(conferenceId)
    const { agent } = await loginAs(conferenceId, 'dash-checklist-convenor@example.com', 'convenor')

    const before = await agent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(before.status).toBe(200)
    expect(before.body.setup_checklist).toMatchObject({
      details_done: false,
      logo_done: false,
      key_dates_done: false,
      tracks_done: false,
      registration_categories_done: false,
      certificate_template_done: false,
      published: false,
    })

    await pool.query('UPDATE conferences SET description = ? WHERE id = ?', ['About this event.', conferenceId])
    await setDeadlineWindow(conferenceId, 'registration', -24, 24)
    await createTrack(conferenceId, 'Systems')
    await pool.query(`INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General')`, [
      conferenceId,
    ])
    await pool.query(
      `INSERT INTO certificate_templates (conference_id, certificate_type, name) VALUES (?, 'participation', 'Participation')`,
      [conferenceId],
    )
    await pool.query(`UPDATE conferences SET status = 'submission_open' WHERE id = ?`, [conferenceId])

    const after = await agent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(after.status).toBe(200)
    expect(after.body.setup_checklist).toMatchObject({
      details_done: true,
      key_dates_done: true,
      tracks_done: true,
      registration_categories_done: true,
      certificate_template_done: true,
      published: true,
    })
  })

  it('counts pending (unconfirmed, payment-required) registrations separately in needs_attention', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId, { registration_requires_payment: true })
    await setDeadlineWindow(conferenceId, 'registration', -24, 24)
    await pool.query(`INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General')`, [
      conferenceId,
    ])
    const [[{ id: categoryId }]] = (await pool.query(
      'SELECT id FROM registration_categories WHERE conference_id = ? AND code = ?',
      [conferenceId, 'general'],
    )) as unknown as [Array<{ id: string }>]

    const { agent: convenorAgent } = await loginAs(conferenceId, 'dash-pending-convenor@example.com', 'convenor')
    const { agent: attendeeAgent } = await loginAs(conferenceId, 'dash-pending-attendee@example.com', 'author')
    const reg = await attendeeAgent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(reg.status).toBe(201)
    expect(reg.body.status).toBe('pending')

    const res = await convenorAgent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(res.status).toBe(200)
    expect(res.body.needs_attention.pending_registrations).toBe(1)
  })

  it('is forbidden for an author (no conference.view_internal permission)', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'dash-author@example.com', 'author')

    const res = await agent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(res.status).toBe(403)
  })

  it('is forbidden for a member of a different conference', async () => {
    const conferenceId = await createConference()
    const otherConferenceId = await createConference({ slug: 'other-conf-dash' })
    const { agent } = await loginAs(otherConferenceId, 'dash-other@example.com', 'convenor')

    const res = await agent.get(`/api/conferences/${conferenceId}/dashboard`)
    expect(res.status).toBe(403)
  })
})
