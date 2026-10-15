import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  addSubmissionAuthor,
  createConference,
  createDirectSession,
  createSubmission,
  createTrack,
  createUser,
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
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAs(conferenceId: string, email: string, role: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  if (conferenceId) await addConferenceMember(conferenceId, userId, role)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function makeRoom(agent: ReturnType<typeof cookieAgent>, conferenceId: string, name = 'Hall A') {
  const res = await agent.post(`/api/conferences/${conferenceId}/rooms`).send({ name, equipment: ['projector'] })
  expect(res.status).toBe(201)
  return res.body.id as string
}

function soon(hoursFromNow: number): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
}

describe('rooms', () => {
  it('creates a room with the full field set and lists it back', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'rooms-convenor@example.com', 'convenor')

    const create = await agent.post(`/api/conferences/${conferenceId}/rooms`).send({
      name: 'Main Hall',
      room_number: '101',
      building: 'Block A',
      floor: '1',
      capacity: 200,
      equipment: ['projector', 'microphone'],
      description: 'The big one.',
    })
    expect(create.status).toBe(201)

    const list = await agent.get(`/api/conferences/${conferenceId}/rooms`)
    const room = list.body.rooms.find((r: { id: string }) => r.id === create.body.id)
    expect(room).toMatchObject({
      name: 'Main Hall',
      room_number: '101',
      building: 'Block A',
      floor: '1',
      capacity: 200,
      equipment: ['projector', 'microphone'],
      description: 'The big one.',
    })
  })

  it('refuses to deactivate a room with a published future session, listing it', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'rooms-convenor2@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)

    const session = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Future Keynote',
      session_type: 'keynote',
      track_id: null,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(3).toISOString(),
      status: 'published',
    })
    expect(session.status).toBe(201)

    const deactivate = await agent.patch(`/api/conferences/${conferenceId}/rooms/${roomId}/status`).send({ status: 'inactive' })
    expect(deactivate.status).toBe(400)
    expect(deactivate.body.error.message).toContain('Future Keynote')
  })

  it('allows deactivating a room with no published future sessions', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'rooms-convenor3@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)

    const res = await agent.patch(`/api/conferences/${conferenceId}/rooms/${roomId}/status`).send({ status: 'inactive' })
    expect(res.status).toBe(200)
  })
})

describe('schedule slots', () => {
  it('creates, lists, and copies a day of slots to another date', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'slots-convenor@example.com', 'convenor')

    const day1 = new Date()
    day1.setUTCHours(9, 0, 0, 0)
    const day1End = new Date(day1.getTime() + 90 * 60 * 1000)

    const create = await agent.post(`/api/conferences/${conferenceId}/schedule-slots`).send({
      label: 'Morning 1',
      starts_at: day1.toISOString(),
      ends_at: day1End.toISOString(),
    })
    expect(create.status).toBe(201)

    const list = await agent.get(`/api/conferences/${conferenceId}/schedule-slots`)
    expect(list.body.slots).toHaveLength(1)

    const fromDate = day1.toISOString().slice(0, 10)
    const toDate = new Date(day1.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const copy = await agent
      .post(`/api/conferences/${conferenceId}/schedule-slots/copy-day`)
      .send({ from_date: fromDate, to_date: toDate })
    expect(copy.status).toBe(200)
    expect(copy.body.created).toBe(1)

    const listAfter = await agent.get(`/api/conferences/${conferenceId}/schedule-slots`)
    expect(listAfter.body.slots).toHaveLength(2)
  })
})

describe('session chairs', () => {
  it('rejects assigning someone who does not hold the session_chair role', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'chair-convenor@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)
    const someone = await createUser({ email: 'not-a-chair@example.com', password: 'Str0ng!Pass' })

    const session = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Panel',
      session_type: 'panel',
      track_id: null,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(3).toISOString(),
      status: 'draft',
    })

    const res = await agent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/chairs`)
      .send({ user_id: someone, chair_role: 'chair' })
    expect(res.status).toBe(400)
  })

  it('assigns a chair, lists them as a candidate, and shows the double-booking trigger message', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'chair-convenor2@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)
    const { userId: chairId } = await loginAs(conferenceId, 'chair-person@example.com', 'session_chair')

    const candidates = await agent.get(`/api/conferences/${conferenceId}/sessions/chair-candidates`)
    expect(candidates.body.candidates.some((c: { user_id: string }) => c.user_id === chairId)).toBe(true)

    const sessionA = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Session A',
      session_type: 'paper',
      track_id: null,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(3).toISOString(),
      status: 'draft',
    })
    const assign = await agent
      .post(`/api/conferences/${conferenceId}/sessions/${sessionA.body.id}/chairs`)
      .send({ user_id: chairId, chair_role: 'chair' })
    expect(assign.status).toBe(201)

    const roomId2 = await makeRoom(agent, conferenceId, 'Hall B')
    const sessionB = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Session B (overlaps A)',
      session_type: 'paper',
      track_id: null,
      room_id: roomId2,
      description: null,
      starts_at: soon(2.5).toISOString(),
      ends_at: soon(3.5).toISOString(),
      status: 'draft',
    })
    const clash = await agent
      .post(`/api/conferences/${conferenceId}/sessions/${sessionB.body.id}/chairs`)
      .send({ user_id: chairId, chair_role: 'chair' })
    expect(clash.status).toBe(400)
    expect(clash.body.error.message).toMatch(/already chairs another session/i)
  })
})

describe('presentations', () => {
  async function setupAcceptedPaper(conferenceId: string, trackId: string) {
    const authorUserId = await createUser({ email: 'paper-author@example.com', password: 'Str0ng!Pass' })
    const submissionId = await createSubmission(conferenceId, trackId, authorUserId, { title: 'A Great Paper' })
    await addSubmissionAuthor(submissionId, {
      fullName: 'Paper Author',
      email: 'paper-author@example.com',
      userId: authorUserId,
      isCorresponding: true,
    })
    return { authorUserId, submissionId }
  }

  it('lists schedulable submissions, adds a paper, notifies the author, and marks the submission scheduled', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'pres-convenor@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)
    const trackId = await createTrack(conferenceId, 'AI')
    const { authorUserId, submissionId } = await setupAcceptedPaper(conferenceId, trackId)

    const schedulable = await agent.get(`/api/conferences/${conferenceId}/sessions/schedulable-submissions`)
    expect(schedulable.body.submissions.some((s: { id: string }) => s.id === submissionId)).toBe(true)

    const session = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Paper Session',
      session_type: 'paper',
      track_id: trackId,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(4).toISOString(),
      status: 'published',
    })

    const add = await agent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/papers`)
      .send({ submission_id: submissionId, duration_minutes: 20 })
    expect(add.status).toBe(201)

    const [subRows] = await pool.query('SELECT status FROM submissions WHERE id = ?', [submissionId])
    expect((subRows as Array<{ status: string }>)[0]!.status).toBe('scheduled')

    const [emailRows] = await pool.query(
      `SELECT template_key FROM email_logs WHERE user_id = ? AND template_key = 'presentation_scheduled'`,
      [authorUserId],
    )
    expect((emailRows as unknown[]).length).toBe(1)

    const schedulableAfter = await agent.get(`/api/conferences/${conferenceId}/sessions/schedulable-submissions`)
    expect(schedulableAfter.body.submissions.some((s: { id: string }) => s.id === submissionId)).toBe(false)

    return { conferenceId, agent, session, submissionId, add }
  })

  it('removing a presentation reverts the submission to its prior status', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'pres-convenor2@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)
    const trackId = await createTrack(conferenceId, 'Systems')
    const { submissionId } = await setupAcceptedPaper(conferenceId, trackId)

    const session = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Removable Session',
      session_type: 'paper',
      track_id: trackId,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(4).toISOString(),
      status: 'published',
    })
    const add = await agent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/papers`)
      .send({ submission_id: submissionId })
    expect(add.status).toBe(201)

    const remove = await agent.delete(
      `/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/${add.body.id}`,
    )
    expect(remove.status).toBe(200)

    const [subRows] = await pool.query('SELECT status FROM submissions WHERE id = ?', [submissionId])
    expect((subRows as Array<{ status: string }>)[0]!.status).toBe('accepted')
  })

  it('reorders presentations and repacks their times back-to-back', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'pres-convenor3@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)
    const trackId = await createTrack(conferenceId, 'Networks')

    const author1 = await createUser({ email: 'author1@example.com', password: 'Str0ng!Pass' })
    const sub1 = await createSubmission(conferenceId, trackId, author1, { title: 'Paper One' })
    await addSubmissionAuthor(sub1, { fullName: 'Author One', email: 'author1@example.com', userId: author1 })
    const author2 = await createUser({ email: 'author2@example.com', password: 'Str0ng!Pass' })
    const sub2 = await createSubmission(conferenceId, trackId, author2, { title: 'Paper Two' })
    await addSubmissionAuthor(sub2, { fullName: 'Author Two', email: 'author2@example.com', userId: author2 })

    const session = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Reorder Session',
      session_type: 'paper',
      track_id: trackId,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(4).toISOString(),
      status: 'published',
    })
    const add1 = await agent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/papers`)
      .send({ submission_id: sub1, duration_minutes: 15 })
    const add2 = await agent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/papers`)
      .send({ submission_id: sub2, duration_minutes: 15 })

    const reorder = await agent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/reorder`)
      .send({ presentation_ids: [add2.body.id, add1.body.id] })
    expect(reorder.status).toBe(200)

    const [rows] = await pool.query(
      'SELECT id, presentation_order, starts_at FROM presentations WHERE session_id = ? ORDER BY presentation_order',
      [session.body.id],
    )
    const ordered = rows as Array<{ id: string; presentation_order: number; starts_at: string }>
    expect(ordered[0]!.id).toBe(add2.body.id)
    expect(ordered[1]!.id).toBe(add1.body.id)
    expect(new Date(ordered[1]!.starts_at).getTime()).toBeGreaterThan(new Date(ordered[0]!.starts_at).getTime())
  })

  it('lets a session chair (without schedule.manage) mark a presentation presented, moving the submission to presented', async () => {
    const conferenceId = await createConference()
    const { agent: convenorAgent } = await loginAs(conferenceId, 'pres-convenor4@example.com', 'convenor')
    const roomId = await makeRoom(convenorAgent, conferenceId)
    const trackId = await createTrack(conferenceId, 'HCI')
    const { submissionId } = await setupAcceptedPaper(conferenceId, trackId)
    const { agent: chairAgent, userId: chairId } = await loginAs(conferenceId, 'chair-marker@example.com', 'session_chair')

    const session = await convenorAgent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Chaired Session',
      session_type: 'paper',
      track_id: trackId,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(4).toISOString(),
      status: 'published',
    })
    await convenorAgent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/chairs`)
      .send({ user_id: chairId, chair_role: 'chair' })
    const add = await convenorAgent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/papers`)
      .send({ submission_id: submissionId })

    const mark = await chairAgent
      .patch(
        `/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/${add.body.id}/mark`,
      )
      .send({ status: 'presented' })
    expect(mark.status).toBe(200)

    const [subRows] = await pool.query('SELECT status FROM submissions WHERE id = ?', [submissionId])
    expect((subRows as Array<{ status: string }>)[0]!.status).toBe('presented')
  })

  it('rejects marking attendance from someone who is neither schedule.manage nor a chair of that session', async () => {
    const conferenceId = await createConference()
    const { agent: convenorAgent } = await loginAs(conferenceId, 'pres-convenor5@example.com', 'convenor')
    const roomId = await makeRoom(convenorAgent, conferenceId)
    const trackId = await createTrack(conferenceId, 'Theory')
    const { submissionId } = await setupAcceptedPaper(conferenceId, trackId)
    const { agent: randomAgent } = await loginAs(conferenceId, 'random-author@example.com', 'author')

    const session = await convenorAgent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Guarded Session',
      session_type: 'paper',
      track_id: trackId,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(4).toISOString(),
      status: 'published',
    })
    const add = await convenorAgent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/papers`)
      .send({ submission_id: submissionId })

    const mark = await randomAgent
      .patch(`/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/${add.body.id}/mark`)
      .send({ status: 'presented' })
    expect(mark.status).toBe(403)
  })
})

describe('warnings', () => {
  it('flags unscheduled accepted papers and published sessions without a chair', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'warn-convenor@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)
    const trackId = await createTrack(conferenceId, 'Misc')
    const authorUserId = await createUser({ email: 'warn-author@example.com', password: 'Str0ng!Pass' })
    const submissionId = await createSubmission(conferenceId, trackId, authorUserId, { title: 'Unscheduled Paper' })

    const session = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Chairless Session',
      session_type: 'paper',
      track_id: trackId,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(3).toISOString(),
      status: 'published',
    })
    expect(session.status).toBe(201)

    const warnings = await agent.get(`/api/conferences/${conferenceId}/sessions/warnings`)
    expect(warnings.status).toBe(200)
    expect(warnings.body.unscheduled_papers.some((p: { id: string }) => p.id === submissionId)).toBe(true)
    expect(warnings.body.sessions_without_chair.some((s: { id: string }) => s.id === session.body.id)).toBe(true)
  })
})

describe('public programme', () => {
  it('shows a published session with its room, chairs and paper authors, and omits unpublished sessions', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'public-convenor@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId, 'Public Hall')
    const trackId = await createTrack(conferenceId, 'Public Track')
    const { submissionId } = await (async () => {
      const authorUserId = await createUser({ email: 'public-author@example.com', password: 'Str0ng!Pass' })
      const submissionId = await createSubmission(conferenceId, trackId, authorUserId, { title: 'Public Paper' })
      await addSubmissionAuthor(submissionId, { fullName: 'Public Author', email: 'public-author@example.com', userId: authorUserId })
      return { submissionId }
    })()

    const published = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Published Session',
      session_type: 'paper',
      track_id: trackId,
      room_id: roomId,
      description: 'A talk about things.',
      starts_at: soon(2).toISOString(),
      ends_at: soon(4).toISOString(),
      status: 'published',
    })
    await agent
      .post(`/api/conferences/${conferenceId}/sessions/${published.body.id}/presentations/papers`)
      .send({ submission_id: submissionId })

    const draft = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Draft Session',
      session_type: 'paper',
      track_id: trackId,
      room_id: roomId,
      description: null,
      starts_at: soon(5).toISOString(),
      ends_at: soon(6).toISOString(),
      status: 'draft',
    })
    expect(draft.status).toBe(201)

    const pub = await request(app).get(`/api/conferences/${conferenceId}/sessions/public`)
    expect(pub.status).toBe(200)
    expect(pub.body.schedule).toHaveLength(1)
    const row = pub.body.schedule[0]
    expect(row.title).toBe('Published Session')
    expect(row.room.name).toBe('Public Hall')
    expect(row.presentations[0].authors).toEqual(['Public Author'])

    const ics = await request(app).get(`/api/conferences/${conferenceId}/sessions/public/${published.body.id}/ics`)
    expect(ics.status).toBe(200)
    expect(ics.headers['content-type']).toContain('text/calendar')
    expect(ics.text).toContain('BEGIN:VEVENT')

    const pdf = await request(app).get(`/api/conferences/${conferenceId}/sessions/public/programme.pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')
  })
})

describe('personal views', () => {
  it('shows the presenting author their own schedule', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'mine-convenor@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)
    const trackId = await createTrack(conferenceId, 'Mine')
    const authorUserId = await createUser({ email: 'mine-author@example.com', password: 'Str0ng!Pass' })
    const submissionId = await createSubmission(conferenceId, trackId, authorUserId, { title: 'My Paper' })
    await addSubmissionAuthor(submissionId, { fullName: 'Mine Author', email: 'mine-author@example.com', userId: authorUserId })

    const session = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'My Session',
      session_type: 'paper',
      track_id: trackId,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(4).toISOString(),
      status: 'published',
    })
    await agent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/presentations/papers`)
      .send({ submission_id: submissionId })

    const authorCookie = await createDirectSession(authorUserId)
    const res = await cookieAgent(authorCookie).get(`/api/conferences/${conferenceId}/my-presentations`)
    expect(res.status).toBe(200)
    expect(res.body.presentations).toHaveLength(1)
    expect(res.body.presentations[0].title).toBe('My Paper')
  })

  it('lists a session chair their assigned sessions via /api/me/chair-sessions', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'chairlist-convenor@example.com', 'convenor')
    const roomId = await makeRoom(agent, conferenceId)
    const { agent: chairAgent, userId: chairId } = await loginAs(conferenceId, 'chairlist-chair@example.com', 'session_chair')

    const session = await agent.post(`/api/conferences/${conferenceId}/sessions`).send({
      title: 'Listed Session',
      session_type: 'paper',
      track_id: null,
      room_id: roomId,
      description: null,
      starts_at: soon(2).toISOString(),
      ends_at: soon(3).toISOString(),
      status: 'published',
    })
    await agent
      .post(`/api/conferences/${conferenceId}/sessions/${session.body.id}/chairs`)
      .send({ user_id: chairId, chair_role: 'chair' })

    const res = await chairAgent.get('/api/me/chair-sessions')
    expect(res.status).toBe(200)
    expect(res.body.sessions.some((s: { session_id: string }) => s.session_id === session.body.id)).toBe(true)
  })
})
