import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { onlineWindow } from '../src/modules/audience/programme.js'
import {
  addConferenceMember,
  createAudienceMember,
  createConference,
  createDirectSession,
  createSessionDirect,
  createUser,
  resetDatabase,
} from './helpers.js'

/** Audience role, Phase 2: programme, speakers, delivery mode and the time-gated online link. */
const app = createApp()

let conferenceId = ''
const MIN = 60_000

async function makeOnline(sessionId: string, mode: 'online' | 'hybrid' = 'online'): Promise<void> {
  await pool.query(
    `UPDATE conference_sessions SET delivery_mode = ?, online_url = 'https://meet.example.org/secret-room', online_instructions = 'Passcode 4321' WHERE id = ?`,
    [mode, sessionId],
  )
}

beforeEach(async () => {
  await resetDatabase()
  conferenceId = await createConference({ status: 'registration_open' })
})

afterAll(async () => {
  await pool.end()
})

describe('online link window', () => {
  it('opens 15 minutes before the start and closes at the end', () => {
    const start = new Date('2026-11-20T10:00:00Z')
    const end = new Date('2026-11-20T11:00:00Z')
    expect(onlineWindow(start, end, new Date('2026-11-20T09:44:59Z')).open).toBe(false)
    expect(onlineWindow(start, end, new Date('2026-11-20T09:45:00Z')).open).toBe(true)
    expect(onlineWindow(start, end, new Date('2026-11-20T11:00:00Z')).open).toBe(true)
    expect(onlineWindow(start, end, new Date('2026-11-20T11:00:01Z')).open).toBe(false)
  })
})

describe('GET /audience/programme', () => {
  it('shows published and cancelled sessions with delivery mode, never drafts or the private link', async () => {
    const now = Date.now()
    const live = await createSessionDirect(conferenceId, { title: 'Opening keynote', startsAt: new Date(now + 60 * MIN), endsAt: new Date(now + 120 * MIN) })
    await makeOnline(live, 'hybrid')
    await createSessionDirect(conferenceId, { title: 'Hidden draft', startsAt: new Date(now), endsAt: new Date(now + MIN), status: 'draft' })
    await createSessionDirect(conferenceId, { title: 'Dropped panel', startsAt: new Date(now), endsAt: new Date(now + MIN), status: 'cancelled' })
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')

    const res = await request(app).get(`/api/conferences/${conferenceId}/audience/programme`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.registered).toBe(true)
    const titles = res.body.sessions.map((s: { title: string }) => s.title).sort()
    expect(titles).toEqual(['Dropped panel', 'Opening keynote'])
    const keynote = res.body.sessions.find((s: { title: string }) => s.title === 'Opening keynote')
    expect(keynote.delivery_mode).toBe('hybrid')
    expect(keynote.online_window.open).toBe(false)
    expect(JSON.stringify(res.body)).not.toContain('secret-room')
    expect(JSON.stringify(res.body)).not.toContain('Passcode')
    expect(res.body.rooms).toEqual([{ id: expect.any(String), name: 'Hall A' }])
  })

  it('marks starred sessions (My agenda)', async () => {
    const now = Date.now()
    const id = await createSessionDirect(conferenceId, { title: 'Starred one', startsAt: new Date(now + MIN), endsAt: new Date(now + 2 * MIN) })
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await request(app).put(`/api/conferences/${conferenceId}/my-agenda/${id}`).set('Cookie', cookie)).status).toBeLessThan(300)
    const res = await request(app).get(`/api/conferences/${conferenceId}/audience/programme`).set('Cookie', cookie)
    expect(res.body.sessions[0].starred).toBe(true)
  })

  it('is 403 for someone without the Audience role, and for another conference', async () => {
    const reviewer = await createUser({ email: 'rev@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewer, 'reviewer')
    const cookie = await createDirectSession(reviewer, conferenceId)
    expect((await request(app).get(`/api/conferences/${conferenceId}/audience/programme`).set('Cookie', cookie)).status).toBe(403)

    const other = await createConference()
    const { cookie: audCookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await request(app).get(`/api/conferences/${other}/audience/programme`).set('Cookie', audCookie)).status).toBe(403)
    expect((await request(app).get(`/api/conferences/${conferenceId}/audience/programme`)).status).toBe(401)
  })
})

describe('POST /audience/sessions/:id/join-online', () => {
  it('gives the link inside the window and records online attendance once', async () => {
    const now = Date.now()
    const id = await createSessionDirect(conferenceId, { title: 'Live now', startsAt: new Date(now - 10 * MIN), endsAt: new Date(now + 50 * MIN) })
    await makeOnline(id)
    const { cookie, userId } = await createAudienceMember(conferenceId, 'aud@example.com')
    const res = await request(app).post(`/api/conferences/${conferenceId}/audience/sessions/${id}/join-online`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.online_url).toBe('https://meet.example.org/secret-room')
    expect(res.body.recorded).toBe(true)
    expect(res.headers['cache-control']).toBe('no-store')
    const again = await request(app).post(`/api/conferences/${conferenceId}/audience/sessions/${id}/join-online`).set('Cookie', cookie)
    expect(again.body.recorded).toBe(false)
    const [rows] = await pool.query('SELECT method FROM session_attendance WHERE user_id = ?', [userId])
    expect(rows).toEqual([{ method: 'online' }])
  })

  it('opens 15 minutes before the start', async () => {
    const now = Date.now()
    const soon = await createSessionDirect(conferenceId, { title: 'Soon', roomName: 'Room Soon', startsAt: new Date(now + 10 * MIN), endsAt: new Date(now + 70 * MIN) })
    const later = await createSessionDirect(conferenceId, { title: 'Later', roomName: 'Room Later', startsAt: new Date(now + 30 * MIN), endsAt: new Date(now + 90 * MIN) })
    const ended = await createSessionDirect(conferenceId, { title: 'Ended', roomName: 'Room Ended', startsAt: new Date(now - 90 * MIN), endsAt: new Date(now - MIN) })
    for (const id of [soon, later, ended]) await makeOnline(id)
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    const join = (id: string) => request(app).post(`/api/conferences/${conferenceId}/audience/sessions/${id}/join-online`).set('Cookie', cookie)
    expect((await join(soon)).status).toBe(200)
    const tooEarly = await join(later)
    expect(tooEarly.status).toBe(403)
    expect(tooEarly.body.error.message).toMatch(/opens 15 minutes before/)
    expect((await join(ended)).status).toBe(403)
  })

  it('refuses unconfirmed registrations, in-person, draft and cancelled sessions', async () => {
    const now = Date.now()
    const live = await createSessionDirect(conferenceId, { title: 'Live', roomName: 'Room Live', startsAt: new Date(now - MIN), endsAt: new Date(now + 60 * MIN) })
    await makeOnline(live)
    const inPerson = await createSessionDirect(conferenceId, { title: 'Room only', roomName: 'Room Room only', startsAt: new Date(now - MIN), endsAt: new Date(now + 60 * MIN) })
    const draft = await createSessionDirect(conferenceId, { title: 'Draft', roomName: 'Room Draft', startsAt: new Date(now - MIN), endsAt: new Date(now + 60 * MIN), status: 'draft' })
    await makeOnline(draft)
    const cancelled = await createSessionDirect(conferenceId, { title: 'Off', roomName: 'Room Off', startsAt: new Date(now - MIN), endsAt: new Date(now + 60 * MIN), status: 'cancelled' })
    await makeOnline(cancelled)

    const pending = await createAudienceMember(conferenceId, 'pending@example.com', { registrationStatus: 'pending' })
    const res = await request(app).post(`/api/conferences/${conferenceId}/audience/sessions/${live}/join-online`).set('Cookie', pending.cookie)
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain('secret-room')

    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    const join = (id: string) => request(app).post(`/api/conferences/${conferenceId}/audience/sessions/${id}/join-online`).set('Cookie', cookie)
    expect((await join(inPerson)).status).toBe(403)
    expect((await join(draft)).status).toBe(404)
    expect((await join(cancelled)).status).toBe(403)
  })

  it('a session of another conference is not found', async () => {
    const other = await createConference()
    const now = Date.now()
    const foreign = await createSessionDirect(other, { title: 'Foreign', startsAt: new Date(now - MIN), endsAt: new Date(now + 60 * MIN) })
    await makeOnline(foreign)
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    const res = await request(app).post(`/api/conferences/${conferenceId}/audience/sessions/${foreign}/join-online`).set('Cookie', cookie)
    expect(res.status).toBe(404)
  })
})

describe('convenor sets delivery mode in the Programme tab', () => {
  async function convenorCookie(): Promise<string> {
    const convenor = await createUser({ email: 'conv@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenor, 'convenor')
    return createDirectSession(convenor, conferenceId)
  }

  async function sessionBody(overrides: Record<string, unknown> = {}) {
    await pool.query('INSERT IGNORE INTO rooms (conference_id, name) VALUES (?, ?)', [conferenceId, 'Hall A'])
    const [rooms] = await pool.query('SELECT id FROM rooms WHERE conference_id = ?', [conferenceId])
    const start = new Date(Date.now() + 5 * MIN)
    return {
      title: 'Hybrid session',
      session_type: 'paper',
      track_id: null,
      room_id: (rooms as Array<{ id: string }>)[0]!.id,
      description: '',
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 30 * MIN).toISOString(),
      status: 'published',
      ...overrides,
    }
  }

  it('requires an https link for online/hybrid, stores it, and keeps it out of the audit log', async () => {
    const cookie = await convenorCookie()
    const missing = await request(app).post(`/api/conferences/${conferenceId}/sessions`).set('Cookie', cookie).send(await sessionBody({ delivery_mode: 'hybrid' }))
    expect(missing.status).toBe(400)
    expect(missing.body.error.fields?.online_url).toBeTruthy()
    const http = await request(app)
      .post(`/api/conferences/${conferenceId}/sessions`)
      .set('Cookie', cookie)
      .send(await sessionBody({ delivery_mode: 'online', online_url: 'http://insecure.example.org' }))
    expect(http.status).toBe(400)

    const ok = await request(app)
      .post(`/api/conferences/${conferenceId}/sessions`)
      .set('Cookie', cookie)
      .send(await sessionBody({ delivery_mode: 'hybrid', online_url: 'https://meet.example.org/abc', online_instructions: 'Mute on entry' }))
    if (ok.status >= 300) throw new Error(JSON.stringify(ok.body))
    const [rows] = await pool.query(`SELECT delivery_mode, online_url, online_instructions FROM conference_sessions WHERE title = 'Hybrid session'`)
    expect(rows).toEqual([{ delivery_mode: 'hybrid', online_url: 'https://meet.example.org/abc', online_instructions: 'Mute on entry' }])
    const [audit] = await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'session.create'`)
    expect(JSON.stringify(audit)).not.toContain('meet.example.org')

    // The public programme never shows it either.
    const pub = await request(app).get(`/api/conferences/${conferenceId}/sessions/public`)
    expect(JSON.stringify(pub.body)).not.toContain('meet.example.org')
  })

  it('switching back to in person clears the link', async () => {
    const cookie = await convenorCookie()
    await request(app)
      .post(`/api/conferences/${conferenceId}/sessions`)
      .set('Cookie', cookie)
      .send(await sessionBody({ delivery_mode: 'online', online_url: 'https://meet.example.org/abc' }))
    const [ids] = await pool.query(`SELECT id FROM conference_sessions WHERE title = 'Hybrid session'`)
    const id = (ids as Array<{ id: string }>)[0]!.id
    const res = await request(app)
      .patch(`/api/conferences/${conferenceId}/sessions/${id}`)
      .set('Cookie', cookie)
      .send(await sessionBody({ delivery_mode: 'in_person', online_url: 'https://meet.example.org/abc' }))
    expect(res.status).toBeLessThan(300)
    const [rows] = await pool.query(`SELECT delivery_mode, online_url FROM conference_sessions WHERE id = ?`, [id])
    expect(rows).toEqual([{ delivery_mode: 'in_person', online_url: null }])
  })
})

describe('GET /audience/speakers', () => {
  it('lists public speakers with research topics and their sessions', async () => {
    await pool.query(
      `INSERT INTO conference_speakers (conference_id, full_name, research_topics, is_public, display_order) VALUES
       (?, 'Dr Public', 'Hydrology, climate adaptation', TRUE, 0), (?, 'Hidden Person', NULL, FALSE, 1)`,
      [conferenceId, conferenceId],
    )
    const [sp] = await pool.query(`SELECT id FROM conference_speakers WHERE full_name = 'Dr Public'`)
    const speakerId = (sp as Array<{ id: string }>)[0]!.id
    const now = Date.now()
    const sessionId = await createSessionDirect(conferenceId, { title: 'Keynote', startsAt: new Date(now + MIN), endsAt: new Date(now + 60 * MIN) })
    await pool.query(
      `INSERT INTO presentations (conference_id, session_id, speaker_id, title, presentation_order, starts_at, ends_at) VALUES (?, ?, ?, 'Rivers', 1, ?, ?)`,
      [conferenceId, sessionId, speakerId, new Date(now + MIN), new Date(now + 20 * MIN)],
    )
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    const res = await request(app).get(`/api/conferences/${conferenceId}/audience/speakers`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.speakers).toHaveLength(1)
    expect(res.body.speakers[0].research_topics).toBe('Hydrology, climate adaptation')
    expect(res.body.speakers[0].sessions.map((s: { title: string }) => s.title)).toEqual(['Keynote'])
  })

  it('convenor can set research topics', async () => {
    const convenor = await createUser({ email: 'conv@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenor, 'convenor')
    const cookie = await createDirectSession(convenor, conferenceId)
    const res = await request(app)
      .post(`/api/conferences/${conferenceId}/speakers`)
      .set('Cookie', cookie)
      .send({ full_name: 'New Speaker', research_topics: 'Glaciers' })
    expect(res.status).toBe(201)
    const [rows] = await pool.query(`SELECT research_topics FROM conference_speakers WHERE full_name = 'New Speaker'`)
    expect(rows).toEqual([{ research_topics: 'Glaciers' }])
  })
})
