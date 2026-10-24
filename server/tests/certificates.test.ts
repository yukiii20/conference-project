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
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAs(conferenceId: string, email: string, role: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  if (conferenceId) await addConferenceMember(conferenceId, userId, role)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function makeRoom(conferenceId: string): Promise<string> {
  await pool.query(`INSERT INTO rooms (conference_id, name, equipment) VALUES (?, 'Hall A', JSON_ARRAY())`, [conferenceId])
  const [rows] = await pool.query('SELECT id FROM rooms WHERE conference_id = ? LIMIT 1', [conferenceId])
  return (rows as Array<{ id: string }>)[0]!.id
}

async function makeCompletedSession(conferenceId: string, roomId: string): Promise<string> {
  await pool.query(
    `INSERT INTO conference_sessions (conference_id, room_id, title, session_type, starts_at, ends_at, status)
     VALUES (?, ?, 'Opening talk', 'keynote', DATE_SUB(NOW(3), INTERVAL 2 HOUR), DATE_SUB(NOW(3), INTERVAL 1 HOUR), 'published')`,
    [conferenceId, roomId],
  )
  const [rows] = await pool.query('SELECT id FROM conference_sessions WHERE conference_id = ? LIMIT 1', [conferenceId])
  return (rows as Array<{ id: string }>)[0]!.id
}

async function registerAndCheckIn(conferenceId: string, userId: string): Promise<void> {
  await pool.query(`INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General')
    ON DUPLICATE KEY UPDATE code = code`, [conferenceId])
  const [catRows] = await pool.query('SELECT id FROM registration_categories WHERE conference_id = ? LIMIT 1', [conferenceId])
  const categoryId = (catRows as Array<{ id: string }>)[0]!.id
  const [confRows] = await pool.query('SELECT code FROM conferences WHERE id = ?', [conferenceId])
  const code = (confRows as Array<{ code: string }>)[0]!.code
  const regNumber = `${code}-R${Math.floor(Math.random() * 100000)}`
  await pool.query(
    `INSERT INTO registrations (conference_id, user_id, category_id, registration_number, status, amount_due, currency, qr_token, confirmed_at)
     VALUES (?, ?, ?, ?, 'confirmed', 0, 'NPR', ?, NOW(3))`,
    [conferenceId, userId, categoryId, regNumber, Math.random().toString(36).slice(2).padEnd(48, '0').slice(0, 48)],
  )
  const [regRows] = await pool.query('SELECT id FROM registrations WHERE conference_id = ? AND user_id = ?', [conferenceId, userId])
  const registrationId = (regRows as Array<{ id: string }>)[0]!.id
  await pool.query(
    `INSERT INTO conference_attendance (conference_id, registration_id, user_id, attendance_date) VALUES (?, ?, ?, CURDATE())`,
    [conferenceId, registrationId, userId],
  )
}

async function submitAReview(conferenceId: string, submissionId: string, reviewerId: string): Promise<void> {
  await pool.query(
    `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, due_at) VALUES (?, ?, ?, 1, DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
    [conferenceId, submissionId, reviewerId],
  )
  const [rows] = await pool.query('SELECT id FROM review_assignments WHERE submission_id = ? AND reviewer_id = ?', [
    submissionId,
    reviewerId,
  ])
  const assignmentId = (rows as Array<{ id: string }>)[0]!.id
  await pool.query(
    `INSERT INTO reviews (assignment_id, originality, quality, relevance, methodology, overall_score, confidence,
       recommendation, comments_to_author, status, submitted_at)
     VALUES (?, 4, 4, 4, 4, 4, 4, 'accept', 'A solid paper.', 'submitted', NOW(3))`,
    [assignmentId],
  )
}

describe('certificate eligibility and issuing', () => {
  it('issues a participation certificate only to confirmed, checked-in attendees', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const { agent: convenorAgent } = await loginAs(conferenceId, 'cert-convenor@example.com', 'convenor')
    const attendee = await createUser({ email: 'cert-attendee@example.com', password: 'Str0ng!Pass' })
    await registerAndCheckIn(conferenceId, attendee)
    // A confirmed-but-never-checked-in user should NOT be eligible.
    await createUser({ email: 'cert-noshow@example.com', password: 'Str0ng!Pass' })

    const preview = await convenorAgent.get(`/api/conferences/${conferenceId}/certificates/preview?type=participation`)
    expect(preview.status).toBe(200)
    expect(preview.body.eligible).toBe(1)

    const generate = await convenorAgent.post(`/api/conferences/${conferenceId}/certificates/generate`).send({
      certificate_type: 'participation',
    })
    expect(generate.status).toBe(200)
    expect(generate.body.issued).toBe(1)

    // Re-running does not create a duplicate.
    const again = await convenorAgent.post(`/api/conferences/${conferenceId}/certificates/generate`).send({
      certificate_type: 'participation',
    })
    expect(again.body.issued).toBe(0)
    expect(again.body.skipped).toBe(1)

    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM certificates WHERE conference_id = ?', [conferenceId])
    expect((rows as Array<{ n: number }>)[0]!.n).toBe(1)
  })

  it('issues a reviewer certificate only to those with a submitted review', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const trackId = await createTrack(conferenceId, 'Track A')
    const author = await createUser({ email: 'rv-author@example.com', password: 'Str0ng!Pass' })
    const submissionId = await createSubmission(conferenceId, trackId, author, { status: 'under_review' })
    const reviewer = await createUser({ email: 'rv-reviewer@example.com', password: 'Str0ng!Pass' })
    await submitAReview(conferenceId, submissionId, reviewer)
    const { agent: convenorAgent } = await loginAs(conferenceId, 'rv-convenor@example.com', 'convenor')

    const generate = await convenorAgent.post(`/api/conferences/${conferenceId}/certificates/generate`).send({
      certificate_type: 'reviewer',
    })
    expect(generate.body.issued).toBe(1)
  })

  it('issues a session_chair certificate only for completed (past, published) sessions', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const roomId = await makeRoom(conferenceId)
    const sessionId = await makeCompletedSession(conferenceId, roomId)
    const chair = await createUser({ email: 'chair-cert@example.com', password: 'Str0ng!Pass' })
    await pool.query(`INSERT INTO session_chairs (session_id, user_id, chair_role) VALUES (?, ?, 'chair')`, [sessionId, chair])
    const { agent: convenorAgent } = await loginAs(conferenceId, 'chair-cert-convenor@example.com', 'convenor')

    const generate = await convenorAgent.post(`/api/conferences/${conferenceId}/certificates/generate`).send({
      certificate_type: 'session_chair',
    })
    expect(generate.body.issued).toBe(1)
  })

  it('issues a best-paper certificate manually to the chosen submission\'s authors', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const trackId = await createTrack(conferenceId, 'Track B')
    const author = await createUser({ email: 'bp-author@example.com', password: 'Str0ng!Pass' })
    const submissionId = await createSubmission(conferenceId, trackId, author, { status: 'accepted' })
    await addSubmissionAuthor(submissionId, { fullName: 'Best Paper Author', email: 'bp-author@example.com', userId: author })
    const { agent: convenorAgent } = await loginAs(conferenceId, 'bp-convenor@example.com', 'convenor')

    const res = await convenorAgent.post(`/api/conferences/${conferenceId}/certificates/best-paper`).send({ submission_id: submissionId })
    expect(res.status).toBe(200)
    expect(res.body.issued).toBe(1)
  })
})

describe('certificate download and verification', () => {
  async function issueParticipationCertificate(
    conferenceId: string,
    attendee: string,
    convenorAgent: ReturnType<typeof cookieAgent>,
  ) {
    await registerAndCheckIn(conferenceId, attendee)
    await convenorAgent.post(`/api/conferences/${conferenceId}/certificates/generate`).send({ certificate_type: 'participation' })
    const [rows] = await pool.query('SELECT id, verification_token FROM certificates WHERE conference_id = ? AND recipient_user_id = ?', [
      conferenceId,
      attendee,
    ])
    return (rows as Array<{ id: string; verification_token: string }>)[0]!
  }

  it('lets the recipient download their own certificate once released, but not before', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const { agent: convenorAgent } = await loginAs(conferenceId, 'release-convenor@example.com', 'convenor')
    const attendee = await createUser({ email: 'dl-attendee@example.com', password: 'Str0ng!Pass' })
    const cert = await issueParticipationCertificate(conferenceId, attendee, convenorAgent)
    const cookie = await createDirectSession(attendee)
    const agent = cookieAgent(cookie)

    const beforeRelease = await agent.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`)
    expect(beforeRelease.status).toBe(403)

    await convenorAgent.post(`/api/conferences/${conferenceId}/certificates/release-now`)

    const afterRelease = await agent.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`)
    expect(afterRelease.status).toBe(200)
    expect(afterRelease.headers['content-type']).toMatch(/pdf/)
  })

  it('reports how many certificates were released, so the convenor gets a real confirmation instead of a blind "done"', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const { agent: convenorAgent } = await loginAs(conferenceId, 'release-count-convenor@example.com', 'convenor')
    const attendee1 = await createUser({ email: 'release-count-1@example.com', password: 'Str0ng!Pass' })
    const attendee2 = await createUser({ email: 'release-count-2@example.com', password: 'Str0ng!Pass' })
    await registerAndCheckIn(conferenceId, attendee1)
    await registerAndCheckIn(conferenceId, attendee2)
    await convenorAgent.post(`/api/conferences/${conferenceId}/certificates/generate`).send({ certificate_type: 'participation' })

    const res = await convenorAgent.post(`/api/conferences/${conferenceId}/certificates/release-now`)
    expect(res.status).toBe(200)
    expect(res.body.released).toBe(2)
  })

  it('blocks a different user without certificate.manage from downloading someone else\'s certificate', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const { agent: convenorAgent } = await loginAs(conferenceId, 'other-convenor@example.com', 'convenor')
    const attendee = await createUser({ email: 'other-attendee@example.com', password: 'Str0ng!Pass' })
    const cert = await issueParticipationCertificate(conferenceId, attendee, convenorAgent)

    const { agent: strangerAgent } = await loginAs(conferenceId, 'stranger@example.com', 'author')
    const res = await strangerAgent.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`)
    expect(res.status).toBe(403)
  })

  it('lets certificate.manage download any certificate even before release', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const { agent: convenorAgent } = await loginAs(conferenceId, 'manage-dl-convenor@example.com', 'convenor')
    const attendee = await createUser({ email: 'manage-dl-attendee@example.com', password: 'Str0ng!Pass' })
    const cert = await issueParticipationCertificate(conferenceId, attendee, convenorAgent)

    const res = await convenorAgent.get(`/api/conferences/${conferenceId}/certificates/${cert.id}/download`)
    expect(res.status).toBe(200)
  })

  it('the public verify endpoint shows valid for an issued certificate and invalid after revoking', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    const { agent: convenorAgent } = await loginAs(conferenceId, 'revoke-convenor@example.com', 'convenor')
    const attendee = await createUser({ email: 'verify-attendee@example.com', password: 'Str0ng!Pass' })
    const cert = await issueParticipationCertificate(conferenceId, attendee, convenorAgent)

    const valid = await request(app).get(`/api/verify/${cert.verification_token}`)
    expect(valid.status).toBe(200)
    expect(valid.body.result.valid).toBe(true)
    expect(valid.body.result.status).toBe('issued')

    await convenorAgent.patch(`/api/conferences/${conferenceId}/certificates/${cert.id}/revoke`).send({ reason: 'Issued in error.' })

    const revoked = await request(app).get(`/api/verify/${cert.verification_token}`)
    expect(revoked.body.result.valid).toBe(false)
    expect(revoked.body.result.status).toBe('revoked')
  })

  it('the public verify endpoint returns null for an unknown token', async () => {
    const res = await request(app).get('/api/verify/does-not-exist-00000000000000000000000000')
    expect(res.status).toBe(200)
    expect(res.body.result).toBeNull()
  })
})

describe('GET /me/certificates (cross-conference)', () => {
  it('only lists released certificates, shows revoked ones, never another user\'s, across every conference', async () => {
    const conferenceA = await createConference()
    const conferenceB = await createConference()
    await upsertConferenceSettings(conferenceA)
    await upsertConferenceSettings(conferenceB)

    const { agent: convenorA } = await loginAs(conferenceA, 'cross-cert-convenor-a@example.com', 'convenor')
    const { agent: convenorB } = await loginAs(conferenceB, 'cross-cert-convenor-b@example.com', 'convenor')

    const attendee = await createUser({ email: 'cross-cert-attendee@example.com', password: 'Str0ng!Pass' })
    const stranger = await createUser({ email: 'cross-cert-stranger@example.com', password: 'Str0ng!Pass' })

    // Conference A: issued but not released — must NOT appear.
    await registerAndCheckIn(conferenceA, attendee)
    await convenorA.post(`/api/conferences/${conferenceA}/certificates/generate`).send({ certificate_type: 'participation' })

    // Conference B: issued and released — must appear.
    await registerAndCheckIn(conferenceB, attendee)
    await convenorB.post(`/api/conferences/${conferenceB}/certificates/generate`).send({ certificate_type: 'participation' })
    await convenorB.post(`/api/conferences/${conferenceB}/certificates/release-now`)

    const attendeeCookie = await createDirectSession(attendee)
    const attendeeAgent = cookieAgent(attendeeCookie)
    const mine = await attendeeAgent.get('/api/me/certificates')
    expect(mine.status).toBe(200)
    expect(mine.body.certificates).toHaveLength(1)
    expect(mine.body.certificates[0].conference_id).toBe(conferenceB)
    expect(mine.body.certificates[0].status).toBe('issued')
    expect(mine.body.certificates[0].verification_token).toBeTruthy()

    // Revoke the released one — it should still show, now as revoked.
    const certId = mine.body.certificates[0].id as string
    await convenorB.patch(`/api/conferences/${conferenceB}/certificates/${certId}/revoke`).send({ reason: 'Test revoke.' })
    const afterRevoke = await attendeeAgent.get('/api/me/certificates')
    expect(afterRevoke.body.certificates).toHaveLength(1)
    expect(afterRevoke.body.certificates[0].status).toBe('revoked')

    // A different user never sees the attendee's certificates.
    const strangerCookie = await createDirectSession(stranger)
    const strangerAgent = cookieAgent(strangerCookie)
    const strangerView = await strangerAgent.get('/api/me/certificates')
    expect(strangerView.body.certificates).toHaveLength(0)
  })

  it('requires a session', async () => {
    const res = await request(app).get('/api/me/certificates')
    expect(res.status).toBe(401)
  })
})
