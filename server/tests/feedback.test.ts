import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createSessionDirect, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

const HOUR = 3_600_000

async function signIn(email: string, fullName = 'Test User') {
  const userId = await createUser({ email, password: 'Str0ng!Pass', fullName })
  return { userId, cookie: await createDirectSession(userId) }
}

async function checkIn(conferenceId: string, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General') ON DUPLICATE KEY UPDATE code = code`,
    [conferenceId],
  )
  const [catRows] = await pool.query('SELECT id FROM registration_categories WHERE conference_id = ? LIMIT 1', [conferenceId])
  const categoryId = (catRows as Array<{ id: string }>)[0]!.id
  await pool.query(
    `INSERT INTO registrations (conference_id, user_id, category_id, registration_number, status, amount_due, currency, qr_token, confirmed_at)
     VALUES (?, ?, ?, ?, 'confirmed', 0, 'NPR', ?, NOW(3))`,
    [conferenceId, userId, categoryId, `FB-R${Math.floor(Math.random() * 1e6)}`, Math.random().toString(36).slice(2).padEnd(48, '0').slice(0, 48)],
  )
  const [regRows] = await pool.query('SELECT id FROM registrations WHERE conference_id = ? AND user_id = ?', [conferenceId, userId])
  await pool.query(`INSERT INTO conference_attendance (conference_id, registration_id, user_id, attendance_date) VALUES (?, ?, ?, CURDATE())`, [
    conferenceId,
    (regRows as Array<{ id: string }>)[0]!.id,
    userId,
  ])
}

/** A conference that ended yesterday, a convenor, one published session, and an open survey (with one custom choice question). */
async function seed(opts: { allowAnonymous?: boolean } = {}) {
  const conferenceId = await createConference()
  await pool.query('UPDATE conferences SET start_date = DATE_SUB(CURDATE(), INTERVAL 2 DAY), end_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = ?', [
    conferenceId,
  ])
  const sessionId = await createSessionDirect(conferenceId, {
    title: 'Opening keynote',
    startsAt: new Date(Date.now() - 48 * HOUR),
    endsAt: new Date(Date.now() - 47 * HOUR),
  })
  const convenor = await signIn('fb-convenor@example.com', 'Convenor Person')
  await addConferenceMember(conferenceId, convenor.userId, 'convenor')

  const save = await request(app)
    .put(`/api/conferences/${conferenceId}/feedback-survey`)
    .set('Cookie', convenor.cookie)
    .send({
      title: 'How did it go?',
      intro: 'Two minutes, promise.',
      opens_at: new Date(Date.now() - HOUR).toISOString(),
      closes_at: new Date(Date.now() + 72 * HOUR).toISOString(),
      allow_anonymous: opts.allowAnonymous ?? true,
      custom_questions: [{ kind: 'choice', prompt: 'How was lunch?', options: ['Good', 'Bad'], is_required: false }],
    })
  expect(save.status).toBe(200)
  const open = await request(app).patch(`/api/conferences/${conferenceId}/feedback-survey/open`).set('Cookie', convenor.cookie).send({ is_open: true })
  expect(open.status).toBe(200)
  expect(open.body.survey.accepting_responses).toBe(true)

  const questions = save.body.questions as Array<{ id: string; builtin_key: string | null; kind: string }>
  const q = (key: string) => questions.find((x) => x.builtin_key === key)!.id
  const lunch = questions.find((x) => x.builtin_key === null)!.id
  return { conferenceId, sessionId, convenor, q, lunch }
}

describe('feedback survey: building and permissions', () => {
  it('requires sign-in (401) and conference.manage (403) to build or read results', async () => {
    const { conferenceId } = await seed()
    expect((await request(app).get(`/api/conferences/${conferenceId}/feedback-survey`)).status).toBe(401)
    expect((await request(app).get(`/api/conferences/${conferenceId}/feedback-survey/form`)).status).toBe(401)
    const outsider = await signIn('fb-outsider@example.com')
    for (const path of ['feedback-survey', 'feedback-survey/results', 'feedback-survey/results.xlsx']) {
      expect((await request(app).get(`/api/conferences/${conferenceId}/${path}`).set('Cookie', outsider.cookie)).status).toBe(403)
    }
    expect((await request(app).post(`/api/conferences/${conferenceId}/feedback-survey/invite`).set('Cookie', outsider.cookie)).status).toBe(403)
  })

  it('creates the built-in questions, audits changes, and refuses to open without dates', async () => {
    const conferenceId = await createConference()
    const convenor = await signIn('fb-convenor@example.com')
    await addConferenceMember(conferenceId, convenor.userId, 'convenor')
    const save = await request(app)
      .put(`/api/conferences/${conferenceId}/feedback-survey`)
      .set('Cookie', convenor.cookie)
      .send({ title: 'Feedback', opens_at: null, closes_at: null, allow_anonymous: true, custom_questions: [] })
    expect(save.status).toBe(200)
    expect(save.body.questions.map((q: { builtin_key: string }) => q.builtin_key)).toEqual([
      'overall',
      'organisation',
      'venue',
      'sessions',
      'best_session',
      'comments',
    ])
    const open = await request(app).patch(`/api/conferences/${conferenceId}/feedback-survey/open`).set('Cookie', convenor.cookie).send({ is_open: true })
    expect(open.status).toBe(400)

    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE conference_id = ? AND action LIKE 'feedback.%'`, [conferenceId])
    expect((audit as Array<{ action: string }>).map((a) => a.action)).toEqual(['feedback.survey_create'])
  })

  it('locks the questions once someone has answered', async () => {
    const { conferenceId, convenor, q } = await seed()
    const attendee = await signIn('fb-attendee@example.com')
    await checkIn(conferenceId, attendee.userId)
    await request(app)
      .post(`/api/conferences/${conferenceId}/feedback-survey/responses`)
      .set('Cookie', attendee.cookie)
      .send({ answers: [{ question_id: q('overall'), rating: 5 }] })
      .expect(201)

    const change = await request(app)
      .put(`/api/conferences/${conferenceId}/feedback-survey`)
      .set('Cookie', convenor.cookie)
      .send({
        title: 'Renamed',
        opens_at: new Date(Date.now() - HOUR).toISOString(),
        closes_at: new Date(Date.now() + HOUR).toISOString(),
        allow_anonymous: true,
        custom_questions: [],
      })
    expect(change.status).toBe(409)
  })
})

describe('feedback survey: answering', () => {
  it('only eligible people (checked in, chair, presenter) can see the form and answer', async () => {
    const { conferenceId, sessionId, q } = await seed()
    const stranger = await signIn('fb-stranger@example.com')
    expect((await request(app).get(`/api/conferences/${conferenceId}/feedback-survey/form`).set('Cookie', stranger.cookie)).status).toBe(403)
    expect(
      (
        await request(app)
          .post(`/api/conferences/${conferenceId}/feedback-survey/responses`)
          .set('Cookie', stranger.cookie)
          .send({ answers: [{ question_id: q('overall'), rating: 3 }] })
      ).status,
    ).toBe(403)
    expect((await request(app).get('/api/me/feedback').set('Cookie', stranger.cookie)).body.surveys).toEqual([])

    const chair = await signIn('fb-chair@example.com')
    await pool.query('INSERT INTO session_chairs (session_id, user_id) VALUES (?, ?)', [sessionId, chair.userId])
    const form = await request(app).get(`/api/conferences/${conferenceId}/feedback-survey/form`).set('Cookie', chair.cookie)
    expect(form.status).toBe(200)
    expect(form.body.sessions.map((s: { id: string }) => s.id)).toEqual([sessionId])
    expect(form.body.responded).toBe(false)

    const mine = await request(app).get('/api/me/feedback').set('Cookie', chair.cookie)
    expect(mine.body.surveys).toHaveLength(1)
    expect(mine.body.surveys[0]).toMatchObject({ conference_id: conferenceId, responded: false })
  })

  it('accepts one response per person and validates answers', async () => {
    const { conferenceId, sessionId, q, lunch } = await seed()
    const attendee = await signIn('fb-attendee@example.com')
    await checkIn(conferenceId, attendee.userId)
    const url = `/api/conferences/${conferenceId}/feedback-survey/responses`

    // "overall" is required.
    const missing = await request(app).post(url).set('Cookie', attendee.cookie).send({ answers: [{ question_id: q('venue'), rating: 4 }] })
    expect(missing.status).toBe(400)
    expect(missing.body.fields?.[q('overall')]).toBeTruthy()
    const badChoice = await request(app)
      .post(url)
      .set('Cookie', attendee.cookie)
      .send({ answers: [{ question_id: q('overall'), rating: 4 }, { question_id: lunch, choice: 'Terrible' }] })
    expect(badChoice.status).toBe(400)

    const ok = await request(app)
      .post(url)
      .set('Cookie', attendee.cookie)
      .send({
        answers: [
          { question_id: q('overall'), rating: 4 },
          { question_id: q('best_session'), session_id: sessionId },
          { question_id: lunch, choice: 'Good' },
          { question_id: q('comments'), text: 'Lovely.' },
        ],
      })
    expect(ok.status).toBe(201)
    const again = await request(app).post(url).set('Cookie', attendee.cookie).send({ answers: [{ question_id: q('overall'), rating: 1 }] })
    expect(again.status).toBe(409)

    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM feedback_responses WHERE conference_id = ?', [conferenceId])
    expect(Number((rows as Array<{ c: number }>)[0]!.c)).toBe(1)
    const form = await request(app).get(`/api/conferences/${conferenceId}/feedback-survey/form`).set('Cookie', attendee.cookie)
    expect(form.body.responded).toBe(true)
  })

  it('refuses answers once the survey is closed', async () => {
    const { conferenceId, convenor, q } = await seed()
    const attendee = await signIn('fb-attendee@example.com')
    await checkIn(conferenceId, attendee.userId)
    await request(app).patch(`/api/conferences/${conferenceId}/feedback-survey/open`).set('Cookie', convenor.cookie).send({ is_open: false }).expect(200)
    const res = await request(app)
      .post(`/api/conferences/${conferenceId}/feedback-survey/responses`)
      .set('Cookie', attendee.cookie)
      .send({ answers: [{ question_id: q('overall'), rating: 5 }] })
    expect(res.status).toBe(404)
  })
})

describe('feedback survey: anonymity and results', () => {
  it('never shows the name of an anonymous respondent, and computes averages', async () => {
    const { conferenceId, convenor, sessionId, q } = await seed()
    const named = await signIn('fb-named@example.com', 'Named Person')
    const hidden = await signIn('fb-hidden@example.com', 'Hidden Person')
    await checkIn(conferenceId, named.userId)
    await checkIn(conferenceId, hidden.userId)
    const url = `/api/conferences/${conferenceId}/feedback-survey/responses`
    await request(app)
      .post(url)
      .set('Cookie', named.cookie)
      .send({ answers: [{ question_id: q('overall'), rating: 5 }, { question_id: q('comments'), text: 'Signed comment' }, { question_id: q('best_session'), session_id: sessionId }] })
      .expect(201)
    await request(app)
      .post(url)
      .set('Cookie', hidden.cookie)
      .send({ is_anonymous: true, answers: [{ question_id: q('overall'), rating: 2 }, { question_id: q('comments'), text: 'Secret comment' }] })
      .expect(201)

    const results = await request(app).get(`/api/conferences/${conferenceId}/feedback-survey/results`).set('Cookie', convenor.cookie)
    expect(results.status).toBe(200)
    expect(results.body.response_count).toBe(2)
    expect(results.body.eligible_count).toBe(2)
    expect(results.body.overall_average).toBe(3.5)
    const comments = results.body.questions.find((x: { builtin_key: string }) => x.builtin_key === 'comments')
    expect(comments.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Signed comment', respondent_name: 'Named Person' }),
        expect.objectContaining({ text: 'Secret comment', respondent_name: null }),
      ]),
    )
    expect(JSON.stringify(results.body)).not.toContain('Hidden Person')
    expect(JSON.stringify(results.body)).not.toContain(hidden.userId)

    const xlsx = await request(app)
      .get(`/api/conferences/${conferenceId}/feedback-survey/results.xlsx`)
      .set('Cookie', convenor.cookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(xlsx.status).toBe(200)
    expect(xlsx.headers['content-type']).toContain('spreadsheetml')
  })

  it('refuses anonymous answers when the convenor switched anonymity off', async () => {
    const { conferenceId, q } = await seed({ allowAnonymous: false })
    const attendee = await signIn('fb-attendee@example.com')
    await checkIn(conferenceId, attendee.userId)
    const res = await request(app)
      .post(`/api/conferences/${conferenceId}/feedback-survey/responses`)
      .set('Cookie', attendee.cookie)
      .send({ is_anonymous: true, answers: [{ question_id: q('overall'), rating: 5 }] })
    expect(res.status).toBe(400)
  })
})

describe('feedback survey: invitations', () => {
  it('emails each eligible person once through the queue, skipping people who already answered', async () => {
    const { conferenceId, convenor, q } = await seed()
    const a = await signIn('fb-a@example.com')
    const b = await signIn('fb-b@example.com')
    await checkIn(conferenceId, a.userId)
    await checkIn(conferenceId, b.userId)
    await request(app)
      .post(`/api/conferences/${conferenceId}/feedback-survey/responses`)
      .set('Cookie', b.cookie)
      .send({ answers: [{ question_id: q('overall'), rating: 4 }] })
      .expect(201)

    const first = await request(app).post(`/api/conferences/${conferenceId}/feedback-survey/invite`).set('Cookie', convenor.cookie)
    expect(first.status).toBe(200)
    expect(first.body.sent).toBe(1)
    expect(first.body.still_to_invite).toBe(0)
    const second = await request(app).post(`/api/conferences/${conferenceId}/feedback-survey/invite`).set('Cookie', convenor.cookie)
    expect(second.body.sent).toBe(0)

    const [emails] = await pool.query(`SELECT recipient_email, status FROM email_logs WHERE template_key = 'feedback_invitation'`)
    expect(emails).toEqual([{ recipient_email: 'fb-a@example.com', status: 'queued' }])
  })

  it('will not invite before the last day of the conference', async () => {
    const { conferenceId, convenor } = await seed()
    await pool.query('UPDATE conferences SET end_date = DATE_ADD(CURDATE(), INTERVAL 5 DAY) WHERE id = ?', [conferenceId])
    const res = await request(app).post(`/api/conferences/${conferenceId}/feedback-survey/invite`).set('Cookie', convenor.cookie)
    expect(res.status).toBe(400)
  })
})
