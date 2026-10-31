import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  createConference,
  createDirectSession,
  createSessionDirect,
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

const START = new Date('2026-11-15T03:15:00.000Z')
const END = new Date('2026-11-15T05:15:00.000Z')

async function person(conferenceId: string, email: string, role?: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  if (role) await addConferenceMember(conferenceId, userId, role)
  return { userId, cookie: await createDirectSession(userId) }
}

async function sessionWithTalks(conferenceId: string) {
  const sessionId = await createSessionDirect(conferenceId, { title: 'Morning papers', startsAt: START, endsAt: END })
  await pool.query(`INSERT INTO conference_speakers (conference_id, full_name, speaker_type) VALUES (?, 'Dr Speaker One', 'invited')`, [
    conferenceId,
  ])
  const [speakerRows] = await pool.query('SELECT id FROM conference_speakers WHERE conference_id = ? LIMIT 1', [conferenceId])
  const speakerId = (speakerRows as Array<{ id: string }>)[0]!.id
  await pool.query(
    `INSERT INTO presentations (conference_id, session_id, speaker_id, title, starts_at, ends_at, presentation_order)
     VALUES (?, ?, ?, 'Talk one', ?, ?, 1), (?, ?, ?, 'Talk two', ?, ?, 2)`,
    [
      conferenceId,
      sessionId,
      speakerId,
      START,
      new Date(START.getTime() + 20 * 60_000),
      conferenceId,
      sessionId,
      speakerId,
      new Date(START.getTime() + 20 * 60_000),
      new Date(START.getTime() + 40 * 60_000),
    ],
  )
  return sessionId
}

describe('session timer', () => {
  it('a chair opens the timer for their own session with the 15 + 5 minute defaults and talks in order', async () => {
    const conferenceId = await createConference()
    const sessionId = await sessionWithTalks(conferenceId)
    const chair = await person(conferenceId, 'timer-chair@example.com', 'session_chair')
    await pool.query('INSERT INTO session_chairs (session_id, user_id) VALUES (?, ?)', [sessionId, chair.userId])

    const res = await request(app).get(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer`).set('Cookie', chair.cookie)
    expect(res.status).toBe(200)
    expect(res.body.timing).toEqual({ talk_minutes: 15, qa_minutes: 5 })
    expect(res.body.overrides).toEqual({ talk_minutes: null, qa_minutes: null })
    expect(res.body.talks.map((t: { title: string }) => t.title)).toEqual(['Talk one', 'Talk two'])
    expect(res.body.talks[0]).toMatchObject({ speaker: 'Dr Speaker One', status: 'scheduled' })
  })

  it('401 signed out, 403 for someone who does not chair the session', async () => {
    const conferenceId = await createConference()
    const sessionId = await sessionWithTalks(conferenceId)
    expect((await request(app).get(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer`)).status).toBe(401)

    const otherChair = await person(conferenceId, 'timer-other-chair@example.com', 'session_chair')
    const res = await request(app).get(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer`).set('Cookie', otherChair.cookie)
    expect(res.status).toBe(403)
  })

  it('the convenor can open any session timer and change the conference default and a per-session override', async () => {
    const conferenceId = await createConference()
    const sessionId = await sessionWithTalks(conferenceId)
    const convenor = await person(conferenceId, 'timer-convenor@example.com', 'convenor')

    const open = await request(app).get(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer`).set('Cookie', convenor.cookie)
    expect(open.status).toBe(200)

    const defaults = await request(app)
      .put(`/api/conferences/${conferenceId}/timer-defaults`)
      .set('Cookie', convenor.cookie)
      .send({ talk_minutes: 12, qa_minutes: 3 })
    expect(defaults.status).toBe(200)
    let timer = await request(app).get(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer`).set('Cookie', convenor.cookie)
    expect(timer.body.timing).toEqual({ talk_minutes: 12, qa_minutes: 3 })

    const override = await request(app)
      .put(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer-settings`)
      .set('Cookie', convenor.cookie)
      .send({ talk_minutes: 25, qa_minutes: null })
    expect(override.status).toBe(200)
    timer = await request(app).get(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer`).set('Cookie', convenor.cookie)
    expect(timer.body.timing).toEqual({ talk_minutes: 25, qa_minutes: 3 })
    expect(timer.body.overrides).toEqual({ talk_minutes: 25, qa_minutes: null })

    const [audit] = await pool.query(
      `SELECT action FROM audit_logs WHERE conference_id = ? AND action LIKE 'timer.%' ORDER BY id`,
      [conferenceId],
    )
    expect((audit as Array<{ action: string }>).map((a) => a.action)).toEqual(['timer.defaults_update', 'timer.session_update'])
  })

  it('a chair cannot change timings, and bad values are rejected', async () => {
    const conferenceId = await createConference()
    const sessionId = await sessionWithTalks(conferenceId)
    const chair = await person(conferenceId, 'timer-chair2@example.com', 'session_chair')
    await pool.query('INSERT INTO session_chairs (session_id, user_id) VALUES (?, ?)', [sessionId, chair.userId])
    const forbidden = await request(app)
      .put(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer-settings`)
      .set('Cookie', chair.cookie)
      .send({ talk_minutes: 30, qa_minutes: 5 })
    expect(forbidden.status).toBe(403)

    const convenor = await person(conferenceId, 'timer-convenor2@example.com', 'convenor')
    const bad = await request(app)
      .put(`/api/conferences/${conferenceId}/timer-defaults`)
      .set('Cookie', convenor.cookie)
      .send({ talk_minutes: 0, qa_minutes: -1 })
    expect(bad.status).toBe(400)
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['talk_minutes', 'qa_minutes']))
  })

  it('a chair can mark a talk presented from the timer', async () => {
    const conferenceId = await createConference()
    const sessionId = await sessionWithTalks(conferenceId)
    const chair = await person(conferenceId, 'timer-chair3@example.com', 'session_chair')
    await pool.query('INSERT INTO session_chairs (session_id, user_id) VALUES (?, ?)', [sessionId, chair.userId])
    const timer = await request(app).get(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer`).set('Cookie', chair.cookie)
    const talkId = timer.body.talks[0].id as string

    const mark = await request(app)
      .patch(`/api/conferences/${conferenceId}/sessions/${sessionId}/presentations/${talkId}/mark`)
      .set('Cookie', chair.cookie)
      .send({ status: 'presented' })
    expect(mark.status).toBe(200)
    const after = await request(app).get(`/api/conferences/${conferenceId}/sessions/${sessionId}/timer`).set('Cookie', chair.cookie)
    expect(after.body.talks[0].status).toBe('presented')
  })
})
