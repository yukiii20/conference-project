import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { qaWindow } from '../src/modules/audience/qa.js'
import {
  addConferenceMember,
  createAudienceMember,
  createConference,
  createDirectSession,
  createSessionDirect,
  createUser,
  resetDatabase,
  setAudienceSettings,
} from './helpers.js'

/** Audience role, Phase 3: session Q&A, votes and moderation. */
const app = createApp()
const MIN = 60_000

let conferenceId = ''
let sessionId = ''

const base = () => `/api/conferences/${conferenceId}`

async function ask(cookie: string, body: Record<string, unknown>, session = sessionId) {
  const res = await request(app).post(`${base()}/audience/sessions/${session}/questions`).set('Cookie', cookie).send(body)
  // Step past the 15-second gap so the next question in a test is accepted.
  await pool.query('UPDATE session_questions SET created_at = created_at - INTERVAL 1 MINUTE')
  return res
}

beforeEach(async () => {
  await resetDatabase()
  conferenceId = await createConference({ status: 'registration_open' })
  const now = Date.now()
  sessionId = await createSessionDirect(conferenceId, { title: 'Live session', startsAt: new Date(now - 10 * MIN), endsAt: new Date(now + 50 * MIN) })
})

afterAll(async () => {
  await pool.end()
})

describe('Q&A window', () => {
  it('opens at the start and closes N minutes after the end', () => {
    const start = '2026-11-20T10:00:00Z'
    const end = '2026-11-20T11:00:00Z'
    expect(qaWindow(start, end, 30, new Date('2026-11-20T09:59:59Z')).open).toBe(false)
    expect(qaWindow(start, end, 30, new Date('2026-11-20T10:00:00Z')).open).toBe(true)
    expect(qaWindow(start, end, 30, new Date('2026-11-20T11:30:00Z')).open).toBe(true)
    expect(qaWindow(start, end, 30, new Date('2026-11-20T11:30:01Z')).open).toBe(false)
    expect(qaWindow(start, end, 0, new Date('2026-11-20T11:00:01Z')).open).toBe(false)
  })

  it('refuses questions before the start and after the convenor-set closing time', async () => {
    const now = Date.now()
    const future = await createSessionDirect(conferenceId, { title: 'Future', roomName: 'Room F', startsAt: new Date(now + 60 * MIN), endsAt: new Date(now + 90 * MIN) })
    const past = await createSessionDirect(conferenceId, { title: 'Past', roomName: 'Room P', startsAt: new Date(now - 90 * MIN), endsAt: new Date(now - 20 * MIN) })
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await ask(cookie, { body: 'Too early?' }, future)).status).toBe(403)
    // Default: open until 30 minutes after the end - the past session ended 20 minutes ago.
    expect((await ask(cookie, { body: 'Still open?' }, past)).status).toBe(201)
    await setAudienceSettings(conferenceId, { qa_minutes_after_end: 10 })
    const closed = await ask(cookie, { body: 'Now closed?' }, past)
    expect(closed.status).toBe(403)
    expect(closed.body.error.message).toMatch(/closed/)
  })
})

describe('asking', () => {
  it('posts a plain-text question, shows the name unless anonymous', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com', { fullName: 'Asha Audience' })
    const res = await ask(cookie, { body: '  What about <b>monsoon</b> data?  <script>x</script>' })
    expect(res.status).toBe(201)
    await ask(cookie, { body: 'A quiet one', is_anonymous: true })

    const other = await createAudienceMember(conferenceId, 'other@example.com')
    const list = await request(app).get(`${base()}/audience/sessions/${sessionId}/questions`).set('Cookie', other.cookie)
    expect(list.status).toBe(200)
    const bodies = list.body.questions.map((q: { body: string }) => q.body)
    expect(bodies).toContain('What about monsoon data?  x')
    const anon = list.body.questions.find((q: { body: string }) => q.body === 'A quiet one')
    expect(anon.author_name).toBeNull()
    expect(JSON.stringify(list.body)).not.toContain('aud@example.com')
    const named = list.body.questions.find((q: { body: string }) => q.body.startsWith('What about'))
    expect(named.author_name).toBe('Asha Audience')
  })

  it('limits questions to 300 characters and 5 per person per session', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await ask(cookie, { body: 'x'.repeat(301) })).status).toBe(400)
    expect((await ask(cookie, { body: '   ' })).status).toBe(400)
    for (let i = 1; i <= 5; i += 1) expect((await ask(cookie, { body: `Question ${i}` })).status).toBe(201)
    const sixth = await ask(cookie, { body: 'Question 6' })
    expect(sixth.status).toBe(409)
  })

  it('needs 15 seconds between two questions', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    const first = await request(app).post(`${base()}/audience/sessions/${sessionId}/questions`).set('Cookie', cookie).send({ body: 'One' })
    expect(first.status).toBe(201)
    const second = await request(app).post(`${base()}/audience/sessions/${sessionId}/questions`).set('Cookie', cookie).send({ body: 'Two' })
    expect(second.status).toBe(429)
  })

  it('needs a confirmed registration and the Audience role', async () => {
    const pending = await createAudienceMember(conferenceId, 'pending@example.com', { registrationStatus: 'pending' })
    expect((await ask(pending.cookie, { body: 'Can I?' })).status).toBe(403)

    const reviewer = await createUser({ email: 'rev@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewer, 'reviewer')
    expect((await ask(await createDirectSession(reviewer, conferenceId), { body: 'Can I?' })).status).toBe(403)
  })

  it('refuses a draft session, a cancelled one, and another conference', async () => {
    const now = Date.now()
    const draft = await createSessionDirect(conferenceId, { title: 'Draft', roomName: 'Room D', startsAt: new Date(now - MIN), endsAt: new Date(now + MIN), status: 'draft' })
    const cancelled = await createSessionDirect(conferenceId, { title: 'Off', roomName: 'Room O', startsAt: new Date(now - MIN), endsAt: new Date(now + MIN), status: 'cancelled' })
    const other = await createConference()
    const foreign = await createSessionDirect(other, { title: 'Foreign', startsAt: new Date(now - MIN), endsAt: new Date(now + MIN) })
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await ask(cookie, { body: 'Hello?' }, draft)).status).toBe(404)
    expect((await ask(cookie, { body: 'Hello?' }, cancelled)).status).toBe(403)
    expect((await ask(cookie, { body: 'Hello?' }, foreign)).status).toBe(404)
  })
})

describe('votes', () => {
  it('one vote per person, not on your own question, and can be taken back', async () => {
    const asker = await createAudienceMember(conferenceId, 'asker@example.com')
    const voter = await createAudienceMember(conferenceId, 'voter@example.com')
    const { body } = await ask(asker.cookie, { body: 'Vote for me' })
    const url = `${base()}/audience/questions/${body.id}/vote`

    expect((await request(app).put(url).set('Cookie', asker.cookie)).status).toBe(400)
    expect((await request(app).put(url).set('Cookie', voter.cookie)).body.vote_count).toBe(1)
    expect((await request(app).put(url).set('Cookie', voter.cookie)).body.vote_count).toBe(1)
    const list = await request(app).get(`${base()}/audience/sessions/${sessionId}/questions`).set('Cookie', voter.cookie)
    expect(list.body.questions[0].voted_by_me).toBe(true)
    expect((await request(app).delete(url).set('Cookie', voter.cookie)).body.vote_count).toBe(0)
    expect((await request(app).delete(url).set('Cookie', voter.cookie)).body.vote_count).toBe(0)
  })

  it('sorts by votes by default and by time on request', async () => {
    const asker = await createAudienceMember(conferenceId, 'asker@example.com')
    const voter = await createAudienceMember(conferenceId, 'voter@example.com')
    const first = await ask(asker.cookie, { body: 'Older question' })
    await ask(asker.cookie, { body: 'Newer question' })
    await request(app).put(`${base()}/audience/questions/${first.body.id}/vote`).set('Cookie', voter.cookie)
    const byVotes = await request(app).get(`${base()}/audience/sessions/${sessionId}/questions`).set('Cookie', voter.cookie)
    expect(byVotes.body.questions.map((q: { body: string }) => q.body)).toEqual(['Older question', 'Newer question'])
    const byTime = await request(app).get(`${base()}/audience/sessions/${sessionId}/questions?sort=recent`).set('Cookie', voter.cookie)
    expect(byTime.body.questions.map((q: { body: string }) => q.body)).toEqual(['Newer question', 'Older question'])
  })
})

describe('moderation', () => {
  async function setup() {
    const asker = await createAudienceMember(conferenceId, 'asker@example.com', { fullName: 'Asha' })
    const anon = await ask(asker.cookie, { body: 'Secret asker', is_anonymous: true })
    const named = await ask(asker.cookie, { body: 'Named asker' })

    const chair = await createUser({ email: 'chair@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, chair, 'session_chair')
    await pool.query(`INSERT INTO session_chairs (session_id, user_id, chair_role) VALUES (?, ?, 'chair')`, [sessionId, chair])
    return { asker, anonId: anon.body.id as string, namedId: named.body.id as string, chairCookie: await createDirectSession(chair, conferenceId) }
  }

  it("the session's chair marks answered, hides and deletes - each audit-logged", async () => {
    const { asker, anonId, namedId, chairCookie } = await setup()
    const list = await request(app).get(`${base()}/sessions/${sessionId}/questions/moderate`).set('Cookie', chairCookie)
    expect(list.status).toBe(200)
    expect(list.body.questions.find((q: { id: string }) => q.id === anonId).author_name).toBeNull()

    expect((await request(app).patch(`${base()}/sessions/${sessionId}/questions/${namedId}`).set('Cookie', chairCookie).send({ status: 'answered' })).status).toBe(200)
    expect((await request(app).patch(`${base()}/sessions/${sessionId}/questions/${anonId}`).set('Cookie', chairCookie).send({ status: 'hidden' })).status).toBe(200)

    // The audience no longer sees the hidden one - except its own asker.
    const other = await createAudienceMember(conferenceId, 'other@example.com')
    const seen = await request(app).get(`${base()}/audience/sessions/${sessionId}/questions`).set('Cookie', other.cookie)
    expect(seen.body.questions.map((q: { id: string }) => q.id)).toEqual([namedId])
    expect(seen.body.questions[0].status).toBe('answered')
    const own = await request(app).get(`${base()}/audience/sessions/${sessionId}/questions`).set('Cookie', asker.cookie)
    expect(own.body.questions.map((q: { id: string }) => q.id).sort()).toEqual([anonId, namedId].sort())

    expect((await request(app).delete(`${base()}/sessions/${sessionId}/questions/${namedId}`).set('Cookie', chairCookie)).status).toBe(200)
    const afterDelete = await request(app).get(`${base()}/sessions/${sessionId}/questions/moderate`).set('Cookie', chairCookie)
    expect(afterDelete.body.questions.map((q: { id: string }) => q.id)).toEqual([anonId])

    const [audit] = await pool.query(
      `SELECT action FROM audit_logs WHERE entity_type = 'session_questions' AND conference_id = ? ORDER BY occurred_at`,
      [conferenceId],
    )
    expect((audit as Array<{ action: string }>).map((a) => a.action)).toEqual(['qa.question_moderated', 'qa.question_moderated', 'qa.question_deleted'])
  })

  it('convenors and managers can moderate any session; a chair of another session cannot', async () => {
    const { namedId } = await setup()
    for (const role of ['convenor', 'manager']) {
      const u = await createUser({ email: `${role}@example.com`, password: 'Str0ng!Pass' })
      await addConferenceMember(conferenceId, u, role)
      const res = await request(app)
        .patch(`${base()}/sessions/${sessionId}/questions/${namedId}`)
        .set('Cookie', await createDirectSession(u, conferenceId))
        .send({ status: role === 'convenor' ? 'answered' : 'visible' })
      expect(res.status).toBe(200)
    }

    const otherSession = await createSessionDirect(conferenceId, { title: 'Other', roomName: 'Room 2', startsAt: new Date(Date.now()), endsAt: new Date(Date.now() + MIN) })
    const otherChair = await createUser({ email: 'otherchair@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, otherChair, 'session_chair')
    await pool.query(`INSERT INTO session_chairs (session_id, user_id, chair_role) VALUES (?, ?, 'chair')`, [otherSession, otherChair])
    const cookie = await createDirectSession(otherChair, conferenceId)
    expect((await request(app).get(`${base()}/sessions/${sessionId}/questions/moderate`).set('Cookie', cookie)).status).toBe(403)
    expect((await request(app).patch(`${base()}/sessions/${sessionId}/questions/${namedId}`).set('Cookie', cookie).send({ status: 'hidden' })).status).toBe(403)
  })

  it('an Audience member, a staff member and a reviewer cannot moderate', async () => {
    const { asker, namedId } = await setup()
    expect((await request(app).get(`${base()}/sessions/${sessionId}/questions/moderate`).set('Cookie', asker.cookie)).status).toBe(403)
    expect((await request(app).delete(`${base()}/sessions/${sessionId}/questions/${namedId}`).set('Cookie', asker.cookie)).status).toBe(403)
    for (const role of ['staff', 'reviewer']) {
      const u = await createUser({ email: `${role}@example.com`, password: 'Str0ng!Pass' })
      await addConferenceMember(conferenceId, u, role)
      const res = await request(app).get(`${base()}/sessions/${sessionId}/questions/moderate`).set('Cookie', await createDirectSession(u, conferenceId))
      expect(res.status).toBe(403)
    }
  })

  it('a question id from another session is not found', async () => {
    const { namedId, chairCookie } = await setup()
    const otherSession = await createSessionDirect(conferenceId, { title: 'Other', roomName: 'Room 2', startsAt: new Date(Date.now() + 120 * MIN), endsAt: new Date(Date.now() + 150 * MIN) })
    await pool.query(`INSERT INTO session_chairs (session_id, user_id, chair_role) SELECT ?, user_id, 'chair' FROM session_chairs WHERE session_id = ?`, [otherSession, sessionId])
    const res = await request(app).patch(`${base()}/sessions/${otherSession}/questions/${namedId}`).set('Cookie', chairCookie).send({ status: 'hidden' })
    expect(res.status).toBe(404)
  })
})
