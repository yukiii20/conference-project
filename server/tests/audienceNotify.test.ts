import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { detectScheduleChanges, sendScheduleChangeEmails } from '../src/modules/audience/scheduleChanges.js'
import {
  addConferenceMember,
  createAudienceMember,
  createConference,
  createDirectSession,
  createSessionDirect,
  createUser,
  resetDatabase,
  setAudienceSettings,
  upsertConferenceSettings,
} from './helpers.js'

/** Audience role, Phase 6: schedule-change notices and batched emails, Audience announcements, certificate progress, report. */
const app = createApp()

let conferenceId = ''
const base = () => `/api/conferences/${conferenceId}`

async function organiser(role = 'convenor'): Promise<string> {
  const u = await createUser({ email: `${role}-${Math.random().toString(36).slice(2, 6)}@example.com`, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, u, role)
  return createDirectSession(u, conferenceId)
}

/** A time inside the conference (its last day, 06:00 UTC = 11:45 in Kathmandu). */
async function insideConference(hourOffset = 0): Promise<Date> {
  const [rows] = await pool.query(`SELECT DATE_FORMAT(end_date, '%Y-%m-%d') AS d FROM conferences WHERE id = ?`, [conferenceId])
  const day = (rows as Array<{ d: string }>)[0]!.d
  return new Date(new Date(`${day}T06:00:00Z`).getTime() + hourOffset * 3_600_000)
}

async function sessionBody(cookie: string, sessionId: string) {
  const res = await request(app).get(`${base()}/sessions/${sessionId}`).set('Cookie', cookie)
  expect(res.status).toBe(200)
  const s = res.body.session
  return {
    title: s.title,
    session_type: s.session_type ?? 'paper',
    track_id: s.track?.id ?? null,
    room_id: s.room.id,
    description: s.description ?? null,
    starts_at: new Date(s.starts_at).toISOString(),
    ends_at: new Date(s.ends_at).toISOString(),
    status: s.status,
    delivery_mode: s.delivery_mode,
    online_url: s.online_url ?? null,
    online_instructions: s.online_instructions ?? null,
  }
}

beforeEach(async () => {
  await resetDatabase()
  conferenceId = await createConference({ status: 'registration_open' })
  await upsertConferenceSettings(conferenceId)
})

afterAll(async () => {
  await pool.end()
})

describe('detectScheduleChanges', () => {
  const base0 = { title: 'Panel', room_id: 'r1', starts_at: '2026-11-20T10:00:00Z', ends_at: '2026-11-20T11:00:00Z', status: 'published', delivery_mode: 'in_person' }
  it('ignores drafts and unchanged sessions, and names each change', () => {
    expect(detectScheduleChanges({ ...base0, status: 'draft' }, { ...base0, status: 'published' })).toEqual([])
    expect(detectScheduleChanges(base0, { ...base0 })).toEqual([])
    expect(detectScheduleChanges(base0, { ...base0, status: 'cancelled' })).toEqual(['cancelled'])
    expect(detectScheduleChanges(base0, { ...base0, starts_at: '2026-11-20T10:30:00Z', room_id: 'r2', title: 'New', delivery_mode: 'hybrid' })).toEqual([
      'time',
      'room',
      'title',
      'mode',
    ])
    expect(detectScheduleChanges({ ...base0, status: 'cancelled' }, base0)).toEqual(['reinstated'])
  })
})

describe('schedule changes', () => {
  it('a published session change notifies registered Audience in the portal and shows a note; drafts stay silent', async () => {
    const cookie = await organiser()
    const starts = await insideConference()
    const sessionId = await createSessionDirect(conferenceId, { title: 'Water panel', startsAt: starts, endsAt: await insideConference(1) })
    const draftId = await createSessionDirect(conferenceId, { title: 'Draft session', startsAt: starts, endsAt: await insideConference(1), status: 'draft', roomName: 'Hall B' })
    const aud = await createAudienceMember(conferenceId, 'aud@example.com')
    const pending = await createAudienceMember(conferenceId, 'pending@example.com', { registrationStatus: 'pending' })

    const body = await sessionBody(cookie, sessionId)
    const moved = { ...body, starts_at: (await insideConference(2)).toISOString(), ends_at: (await insideConference(3)).toISOString() }
    expect((await request(app).patch(`${base()}/sessions/${sessionId}`).set('Cookie', cookie).send(moved)).status).toBe(200)
    const draftBody = await sessionBody(cookie, draftId)
    expect((await request(app).patch(`${base()}/sessions/${draftId}`).set('Cookie', cookie).send({ ...draftBody, title: 'Draft renamed' })).status).toBe(200)

    const [changes] = await pool.query('SELECT session_id, summary FROM schedule_changes WHERE conference_id = ?', [conferenceId])
    expect(changes).toHaveLength(1)
    expect((changes as Array<{ summary: string }>)[0]!.summary).toMatch(/^Water panel: moved to /)

    const [notes] = await pool.query(`SELECT user_id, title FROM notifications WHERE conference_id = ? AND type = 'schedule'`, [conferenceId])
    expect((notes as Array<{ user_id: string }>).map((n) => n.user_id)).toEqual([aud.userId])
    expect((notes as Array<{ user_id: string }>).map((n) => n.user_id)).not.toContain(pending.userId)

    const programme = await request(app).get(`${base()}/audience/programme`).set('Cookie', aud.cookie)
    const session = programme.body.sessions.find((s: { id: string }) => s.id === sessionId)
    expect(session.schedule_change).toMatchObject({ kinds: ['time'], summary: expect.stringMatching(/^Water panel/) })
  })

  it('cancelling says so', async () => {
    const cookie = await organiser()
    const sessionId = await createSessionDirect(conferenceId, { title: 'Closing talk', startsAt: await insideConference(), endsAt: await insideConference(1) })
    await createAudienceMember(conferenceId, 'aud@example.com')
    const body = await sessionBody(cookie, sessionId)
    await request(app).patch(`${base()}/sessions/${sessionId}`).set('Cookie', cookie).send({ ...body, status: 'cancelled' })
    const [notes] = await pool.query(`SELECT title, body FROM notifications WHERE conference_id = ? AND type = 'schedule'`, [conferenceId])
    expect(notes).toEqual([{ title: 'Session cancelled', body: 'Closing talk: cancelled.' }])
  })

  it('deleting a published session tells the Audience it is gone', async () => {
    const cookie = await organiser()
    const sessionId = await createSessionDirect(conferenceId, { title: 'Late slot', startsAt: await insideConference(), endsAt: await insideConference(1) })
    await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await request(app).delete(`${base()}/sessions/${sessionId}`).set('Cookie', cookie)).status).toBeLessThan(300)
    const [notes] = await pool.query(`SELECT title, body FROM notifications WHERE conference_id = ? AND type = 'schedule'`, [conferenceId])
    expect(notes).toEqual([{ title: 'Session cancelled', body: 'Late slot: removed from the programme.' }])
  })

  it('emails one summary per person after 15 minutes, only once, and not at all when switched off', async () => {
    const cookie = await organiser()
    const a = await createSessionDirect(conferenceId, { title: 'Session A', startsAt: await insideConference(), endsAt: await insideConference(1) })
    const b = await createSessionDirect(conferenceId, { title: 'Session B', startsAt: await insideConference(), endsAt: await insideConference(1), roomName: 'Hall B' })
    const aud = await createAudienceMember(conferenceId, 'aud@example.com')
    await createAudienceMember(conferenceId, 'aud2@example.com')
    for (const id of [a, b]) {
      const body = await sessionBody(cookie, id)
      await request(app).patch(`${base()}/sessions/${id}`).set('Cookie', cookie).send({ ...body, title: `${body.title} (new)` })
    }

    const countEmails = async () => {
      const [rows] = await pool.query(`SELECT user_id, template_data FROM email_logs WHERE conference_id = ? AND template_key = 'audience_schedule_changed'`, [conferenceId])
      return rows as Array<{ user_id: string; template_data: unknown }>
    }
    await sendScheduleChangeEmails()
    expect(await countEmails()).toHaveLength(0) // still inside the 15-minute window

    await pool.query('UPDATE schedule_changes SET created_at = NOW(3) - INTERVAL 16 MINUTE WHERE conference_id = ?', [conferenceId])
    await sendScheduleChangeEmails()
    const emails = await countEmails()
    expect(emails).toHaveLength(2)
    const mine = emails.find((e) => e.user_id === aud.userId)!
    const data = typeof mine.template_data === 'string' ? JSON.parse(mine.template_data) : mine.template_data
    expect(data.changes).toContain('Session A (new)')
    expect(data.changes).toContain('Session B (new)')

    await sendScheduleChangeEmails()
    expect(await countEmails()).toHaveLength(2) // nothing sent twice

    // Switched off: the next change is only marked, never emailed.
    await setAudienceSettings(conferenceId, { schedule_change_emails: false })
    const body = await sessionBody(cookie, a)
    await request(app).patch(`${base()}/sessions/${a}`).set('Cookie', cookie).send({ ...body, title: 'Session A again' })
    await pool.query('UPDATE schedule_changes SET created_at = NOW(3) - INTERVAL 16 MINUTE WHERE emailed_at IS NULL')
    await sendScheduleChangeEmails()
    expect(await countEmails()).toHaveLength(2)
    const [left] = await pool.query('SELECT COUNT(*) AS n FROM schedule_changes WHERE emailed_at IS NULL')
    expect(Number((left as Array<{ n: number }>)[0]!.n)).toBe(0)
  })
})

describe('announcements to the Audience', () => {
  it('an announcement for "audience" reaches Audience members only', async () => {
    const cookie = await organiser()
    const aud = await createAudienceMember(conferenceId, 'aud@example.com')
    const author = await createUser({ email: 'author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, author, 'author')
    const res = await request(app)
      .post(`${base()}/announcements`)
      .set('Cookie', cookie)
      .send({ title: 'Doors open at 9', body: 'Bring your QR ticket.', audience: ['audience'], status: 'published' })
    expect(res.status).toBeLessThan(300)
    const [rows] = await pool.query(`SELECT user_id FROM notifications WHERE conference_id = ? AND type = 'announcement'`, [conferenceId])
    expect((rows as Array<{ user_id: string }>).map((r) => r.user_id)).toEqual([aud.userId])
  })
})

describe('certificate progress', () => {
  async function checkIn(registrationId: string, userId: string) {
    await pool.query(`INSERT INTO conference_attendance (conference_id, registration_id, user_id, attendance_date) VALUES (?, ?, ?, CURDATE())`, [
      conferenceId,
      registrationId,
      userId,
    ])
  }
  async function attend(sessionTitle: string, registrationId: string, userId: string, method: 'qr' | 'online') {
    const id = await createSessionDirect(conferenceId, { title: sessionTitle, startsAt: await insideConference(), endsAt: await insideConference(1), roomName: sessionTitle })
    await pool.query(`INSERT INTO session_attendance (conference_id, session_id, user_id, registration_id, method) VALUES (?, ?, ?, ?, ?)`, [
      conferenceId,
      id,
      userId,
      registrationId,
      method,
    ])
  }

  it('explains in plain words what is missing, counts QR and online sessions, and follows the release date', async () => {
    await pool.query('UPDATE conference_settings SET certificate_min_sessions = 3 WHERE conference_id = ?', [conferenceId])
    const aud = await createAudienceMember(conferenceId, 'aud@example.com')
    const get = async () => (await request(app).get(`${base()}/audience/certificate-progress`).set('Cookie', aud.cookie)).body

    expect((await get()).message).toMatch(/not been checked in/)
    await checkIn(aud.registrationId, aud.userId)
    await attend('Room 1', aud.registrationId, aud.userId, 'qr')
    await attend('Room 2', aud.registrationId, aud.userId, 'online')
    let p = await get()
    expect(p).toMatchObject({ checked_in: true, sessions_attended: 2, min_sessions: 3, eligible: false, sessions_by_method: { qr: 1, online: 1 } })
    expect(p.message).toMatch(/attended 2 of the 3 sessions/)

    await attend('Room 3', aud.registrationId, aud.userId, 'qr')
    await pool.query(`INSERT INTO conference_deadlines (conference_id, deadline_type, opens_at) VALUES (?, 'certificate_release', NOW(3) + INTERVAL 2 DAY)`, [conferenceId])
    p = await get()
    expect(p).toMatchObject({ eligible: true, released: false, certificate: null })
    expect(p.message).toMatch(/You qualify. Certificates are available from/)

    await pool.query(`UPDATE conference_deadlines SET opens_at = NOW(3) - INTERVAL 1 HOUR WHERE conference_id = ?`, [conferenceId])
    await pool.query(
      `INSERT INTO certificates (conference_id, recipient_user_id, recipient_name, certificate_type, certificate_number, verification_token)
       VALUES (?, ?, 'Audience Member', 'participation', 'CERT-0001', REPLACE(UUID(), '-', ''))`,
      [conferenceId, aud.userId],
    )
    p = await get()
    expect(p).toMatchObject({ released: true, certificate: { certificate_number: 'CERT-0001' } })
    expect(p.message).toBe('Your certificate is ready to download.')
  })

  it('is refused to people without the Audience role', async () => {
    const reviewer = await organiser('reviewer')
    expect((await request(app).get(`${base()}/audience/certificate-progress`).set('Cookie', reviewer)).status).toBe(403)
  })
})

describe('Audience report', () => {
  it('lists each Audience member with attendance and participation, as JSON and CSV, for organisers only', async () => {
    const aud = await createAudienceMember(conferenceId, 'aud@example.com', { fullName: 'Asha Audience' })
    await pool.query(`INSERT INTO conference_attendance (conference_id, registration_id, user_id, attendance_date) VALUES (?, ?, ?, CURDATE())`, [
      conferenceId,
      aud.registrationId,
      aud.userId,
    ])
    await createAudienceMember(conferenceId, '=cmd@example.com', { fullName: '=HYPERLINK("x")' })

    const cookie = await organiser('manager')
    const res = await request(app).get(`${base()}/audience-report`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.summary).toMatchObject({ audience_members: 2, confirmed: 2, checked_in: 1, certificate_eligible: 1 })
    expect(res.body.rows.find((r: { full_name: string }) => r.full_name === 'Asha Audience')).toMatchObject({ checked_in: true, certificate_eligible: true })

    const csv = await request(app).get(`${base()}/audience-report/export.csv`).set('Cookie', cookie)
    expect(csv.status).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.text).toContain('Asha Audience')
    expect(csv.text).toContain(`'=HYPERLINK`) // formula-like text is neutralised

    const sessionId = await createSessionDirect(conferenceId, { title: 'Q&A session', startsAt: await insideConference(), endsAt: await insideConference(1) })
    await pool.query(
      `INSERT INTO session_questions (conference_id, session_id, user_id, body, is_anonymous, status, vote_count) VALUES
       (?, ?, ?, 'How was the water sampled?', TRUE, 'visible', 3), (?, ?, ?, 'Removed one', FALSE, 'deleted', 0)`,
      [conferenceId, sessionId, aud.userId, conferenceId, sessionId, aud.userId],
    )
    const qcsv = await request(app).get(`${base()}/audience-report/questions.csv`).set('Cookie', cookie)
    expect(qcsv.status).toBe(200)
    expect(qcsv.text).toContain('How was the water sampled?')
    expect(qcsv.text).toContain('Asha Audience') // organisers see who asked, even when anonymous
    expect(qcsv.text).not.toContain('Removed one')
    expect((await request(app).get(`${base()}/audience-report/questions.csv`).set('Cookie', aud.cookie)).status).toBe(403)

    for (const role of ['staff', 'reviewer', 'session_chair']) {
      expect((await request(app).get(`${base()}/audience-report`).set('Cookie', await organiser(role))).status).toBe(403)
    }
    expect((await request(app).get(`${base()}/audience-report`).set('Cookie', aud.cookie)).status).toBe(403)
  })
})
