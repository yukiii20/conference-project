import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  addSubmissionAuthor,
  createConference,
  createDirectSession,
  createSessionDirect,
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

/** 2026-11-15 09:00 Asia/Kathmandu = 03:15 UTC. */
const NINE_AM_KTM = new Date('2026-11-15T03:15:00.000Z')

function at(minutesAfterNine: number): Date {
  return new Date(NINE_AM_KTM.getTime() + minutesAfterNine * 60_000)
}

async function signIn(email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  const cookie = await createDirectSession(userId)
  return { userId, cookie }
}

/** Unfolds RFC 5545 continuation lines so assertions can match whole properties. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n')
}

describe('my agenda', () => {
  it('requires sign-in (401)', async () => {
    const conferenceId = await createConference()
    const res = await request(app).get(`/api/conferences/${conferenceId}/my-agenda`)
    expect(res.status).toBe(401)
  })

  it('stars and unstars a published session, warns about clashes, and refuses drafts', async () => {
    const conferenceId = await createConference()
    const keynote = await createSessionDirect(conferenceId, { title: 'Keynote', startsAt: at(0), endsAt: at(60) })
    const parallel = await createSessionDirect(conferenceId, {
      title: 'Parallel track',
      startsAt: at(30),
      endsAt: at(90),
      roomName: 'Hall B',
    })
    const draft = await createSessionDirect(conferenceId, {
      title: 'Secret draft',
      startsAt: at(200),
      endsAt: at(260),
      status: 'draft',
    })
    const { cookie } = await signIn('agenda-attendee@example.com')

    expect((await request(app).put(`/api/conferences/${conferenceId}/my-agenda/${keynote}`).set('Cookie', cookie)).status).toBe(200)
    // Starring twice is harmless.
    expect((await request(app).put(`/api/conferences/${conferenceId}/my-agenda/${keynote}`).set('Cookie', cookie)).status).toBe(200)
    expect((await request(app).put(`/api/conferences/${conferenceId}/my-agenda/${parallel}`).set('Cookie', cookie)).status).toBe(200)
    expect((await request(app).put(`/api/conferences/${conferenceId}/my-agenda/${draft}`).set('Cookie', cookie)).status).toBe(404)

    const agenda = await request(app).get(`/api/conferences/${conferenceId}/my-agenda`).set('Cookie', cookie)
    expect(agenda.status).toBe(200)
    expect(agenda.body.sessions.map((s: { id: string }) => s.id)).toEqual([keynote, parallel])
    expect(agenda.body.sessions[0].reasons).toEqual(['starred'])
    expect(agenda.body.sessions[0].clashes_with).toEqual([parallel])

    expect((await request(app).delete(`/api/conferences/${conferenceId}/my-agenda/${parallel}`).set('Cookie', cookie)).status).toBe(200)
    const after = await request(app).get(`/api/conferences/${conferenceId}/my-agenda`).set('Cookie', cookie)
    expect(after.body.sessions.map((s: { id: string }) => s.id)).toEqual([keynote])
    expect(after.body.sessions[0].clashes_with).toEqual([])
  })

  it("adds a chair's own sessions and an author's own presentations automatically, marked", async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Main')
    const chaired = await createSessionDirect(conferenceId, { title: 'Chaired session', startsAt: at(0), endsAt: at(60) })
    const presenting = await createSessionDirect(conferenceId, { title: 'Paper session', startsAt: at(120), endsAt: at(180) })
    await createSessionDirect(conferenceId, { title: 'Unrelated', startsAt: at(240), endsAt: at(300) })

    const { userId, cookie } = await signIn('agenda-chair-author@example.com')
    await addConferenceMember(conferenceId, userId, 'session_chair')
    await pool.query('INSERT INTO session_chairs (session_id, user_id) VALUES (?, ?)', [chaired, userId])

    const otherAuthor = await createUser({ email: 'agenda-other@example.com', password: 'Str0ng!Pass' })
    const submissionId = await createSubmission(conferenceId, trackId, otherAuthor, { title: 'Co-authored paper', status: 'scheduled' })
    await addSubmissionAuthor(submissionId, { fullName: 'Other', email: 'agenda-other@example.com', userId: otherAuthor, order: 1 })
    await addSubmissionAuthor(submissionId, {
      fullName: 'Me',
      email: 'agenda-chair-author@example.com',
      userId,
      order: 2,
      isCorresponding: false,
    })
    await pool.query(
      `INSERT INTO presentations (conference_id, session_id, submission_id, presenter_user_id, starts_at, ends_at, presentation_order)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [conferenceId, presenting, submissionId, otherAuthor, at(120), at(135)],
    )

    const agenda = await request(app).get(`/api/conferences/${conferenceId}/my-agenda`).set('Cookie', cookie)
    expect(agenda.status).toBe(200)
    const byId = new Map(agenda.body.sessions.map((s: { id: string; reasons: string[] }) => [s.id, s.reasons]))
    expect([...byId.keys()]).toEqual([chaired, presenting])
    expect(byId.get(chaired)).toEqual(['chair'])
    expect(byId.get(presenting)).toEqual(['presenting'])

    const confs = await request(app).get('/api/me/agenda-conferences').set('Cookie', cookie)
    expect(confs.body.conferences.map((c: { id: string }) => c.id)).toContain(conferenceId)
  })

  it('downloads my agenda as a valid .ics with Kathmandu times', async () => {
    const conferenceId = await createConference()
    const keynote = await createSessionDirect(conferenceId, { title: 'Keynote', startsAt: at(0), endsAt: at(60) })
    const { cookie } = await signIn('agenda-ics@example.com')
    await request(app).put(`/api/conferences/${conferenceId}/my-agenda/${keynote}`).set('Cookie', cookie)

    const res = await request(app).get(`/api/conferences/${conferenceId}/my-agenda.ics`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/calendar')
    const lines = unfold(res.text)
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1)
    expect(lines).toContain('DTSTART;TZID=Asia/Kathmandu:20261115T090000')
    expect(lines).toContain(`UID:${keynote}@conference-management-system`)
  })

  it('the public per-session .ics uses the conference timezone too', async () => {
    const conferenceId = await createConference()
    const keynote = await createSessionDirect(conferenceId, { title: 'Keynote', startsAt: at(0), endsAt: at(60) })
    const res = await request(app).get(`/api/conferences/${conferenceId}/sessions/public/${keynote}/ics`)
    expect(res.status).toBe(200)
    expect(unfold(res.text)).toContain('DTSTART;TZID=Asia/Kathmandu:20261115T090000')
  })
})

describe('private calendar feed', () => {
  it('serves the agenda by secret token, and a reset kills the old URL at once', async () => {
    const conferenceId = await createConference()
    const keynote = await createSessionDirect(conferenceId, { title: 'Keynote', startsAt: at(0), endsAt: at(60) })
    const { cookie } = await signIn('agenda-feed@example.com')
    await request(app).put(`/api/conferences/${conferenceId}/my-agenda/${keynote}`).set('Cookie', cookie)

    const first = await request(app).get(`/api/conferences/${conferenceId}/my-agenda-feed`).set('Cookie', cookie)
    expect(first.status).toBe(200)
    // Asking again returns the same link until it is reset.
    const again = await request(app).get(`/api/conferences/${conferenceId}/my-agenda-feed`).set('Cookie', cookie)
    expect(again.body.url).toBe(first.body.url)

    const oldPath = new URL(first.body.url).pathname
    expect(oldPath).toMatch(/^\/api\/calendar\/[0-9a-f]{64}\.ics$/)
    const feed = await request(app).get(oldPath)
    expect(feed.status).toBe(200)
    expect(unfold(feed.text)).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT60M')
    expect(unfold(feed.text)).toContain('SUMMARY:Test Conference: Keynote')

    const reset = await request(app).post(`/api/conferences/${conferenceId}/my-agenda-feed/reset`).set('Cookie', cookie)
    expect(reset.status).toBe(200)
    expect(reset.body.url).not.toBe(first.body.url)
    expect((await request(app).get(oldPath)).status).toBe(404)
    expect((await request(app).get(new URL(reset.body.url).pathname)).status).toBe(200)

    const [audit] = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'agenda.feed_reset' AND conference_id = ?`, [conferenceId])
    expect((audit as unknown[]).length).toBe(1)
  })

  it('rejects malformed and unknown tokens', async () => {
    expect((await request(app).get('/api/calendar/not-a-token.ics')).status).toBe(404)
    expect((await request(app).get(`/api/calendar/${'a'.repeat(64)}.ics`)).status).toBe(404)
  })

  it("one person's feed never shows another person's stars", async () => {
    const conferenceId = await createConference()
    const keynote = await createSessionDirect(conferenceId, { title: 'Keynote', startsAt: at(0), endsAt: at(60) })
    const alice = await signIn('agenda-alice@example.com')
    const bob = await signIn('agenda-bob@example.com')
    await request(app).put(`/api/conferences/${conferenceId}/my-agenda/${keynote}`).set('Cookie', alice.cookie)

    const bobFeed = await request(app).get(`/api/conferences/${conferenceId}/my-agenda-feed`).set('Cookie', bob.cookie)
    const feed = await request(app).get(new URL(bobFeed.body.url).pathname)
    expect(feed.text).not.toContain('BEGIN:VEVENT')
  })
})
