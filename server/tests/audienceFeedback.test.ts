import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
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

/** Audience role, Phase 4: conference feedback, session ratings, organiser view + moderation + CSV. */
const app = createApp()
const MIN = 60_000

let conferenceId = ''
let startedId = ''
let futureId = ''
const base = () => `/api/conferences/${conferenceId}`

async function organiserCookie(role = 'convenor', email = `${role}@example.com`): Promise<string> {
  const u = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, u, role)
  return createDirectSession(u, conferenceId)
}

beforeEach(async () => {
  await resetDatabase()
  conferenceId = await createConference({ status: 'registration_open' })
  const now = Date.now()
  startedId = await createSessionDirect(conferenceId, { title: 'Started session', startsAt: new Date(now - 30 * MIN), endsAt: new Date(now + 30 * MIN) })
  futureId = await createSessionDirect(conferenceId, { title: 'Future session', roomName: 'Hall B', startsAt: new Date(now + 60 * MIN), endsAt: new Date(now + 90 * MIN) })
})

afterAll(async () => {
  await pool.end()
})

describe('conference feedback', () => {
  it('one per person: the second save edits it', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    const first = await request(app).put(`${base()}/audience/feedback`).set('Cookie', cookie).send({ rating: 4, liked: 'Great <i>talks</i>' })
    expect(first.status).toBe(201)
    const second = await request(app).put(`${base()}/audience/feedback`).set('Cookie', cookie).send({ rating: 5, improve: 'More coffee' })
    expect(second.status).toBe(200)
    const [rows] = await pool.query(`SELECT rating, liked, improve, source FROM conference_feedback WHERE conference_id = ?`, [conferenceId])
    expect(rows).toEqual([{ rating: 5, liked: null, improve: 'More coffee', source: 'audience' }])
    const mine = await request(app).get(`${base()}/audience/feedback`).set('Cookie', cookie)
    expect(mine.body.conference.rating).toBe(5)
  })

  it('validates the rating and strips markup', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await request(app).put(`${base()}/audience/feedback`).set('Cookie', cookie).send({ rating: 6 })).status).toBe(400)
    expect((await request(app).put(`${base()}/audience/feedback`).set('Cookie', cookie).send({ rating: 0 })).status).toBe(400)
    await request(app).put(`${base()}/audience/feedback`).set('Cookie', cookie).send({ rating: 3, liked: 'Great <i>talks</i>' })
    const [rows] = await pool.query(`SELECT liked FROM conference_feedback WHERE conference_id = ?`, [conferenceId])
    expect(rows).toEqual([{ liked: 'Great talks' }])
  })

  it('closes on the optional closing date', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    await setAudienceSettings(conferenceId, { audience_feedback_closes_at: new Date(Date.now() - MIN) })
    const res = await request(app).put(`${base()}/audience/feedback`).set('Cookie', cookie).send({ rating: 4 })
    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(/closed/)
  })

  it('is refused without the Audience role', async () => {
    const reviewer = await organiserCookie('reviewer')
    expect((await request(app).put(`${base()}/audience/feedback`).set('Cookie', reviewer).send({ rating: 4 })).status).toBe(403)
  })
})

describe('session ratings', () => {
  it('only for a confirmed registration, only after the session starts, one per session (editable)', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    const early = await request(app).put(`${base()}/audience/sessions/${futureId}/rating`).set('Cookie', cookie).send({ rating: 5 })
    expect(early.status).toBe(403)
    expect(early.body.error.message).toMatch(/once it has started/)

    expect((await request(app).put(`${base()}/audience/sessions/${startedId}/rating`).set('Cookie', cookie).send({ rating: 3 })).status).toBe(201)
    expect((await request(app).put(`${base()}/audience/sessions/${startedId}/rating`).set('Cookie', cookie).send({ rating: 4, comment: 'Clear' })).status).toBe(200)
    const [rows] = await pool.query(`SELECT rating, comment FROM session_ratings WHERE session_id = ?`, [startedId])
    expect(rows).toEqual([{ rating: 4, comment: 'Clear' }])

    const pending = await createAudienceMember(conferenceId, 'pending@example.com', { registrationStatus: 'pending' })
    expect((await request(app).put(`${base()}/audience/sessions/${startedId}/rating`).set('Cookie', pending.cookie).send({ rating: 2 })).status).toBe(403)
  })

  it('stops editing after the closing date', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    await request(app).put(`${base()}/audience/sessions/${startedId}/rating`).set('Cookie', cookie).send({ rating: 3 })
    await setAudienceSettings(conferenceId, { audience_feedback_closes_at: new Date(Date.now() - MIN) })
    expect((await request(app).put(`${base()}/audience/sessions/${startedId}/rating`).set('Cookie', cookie).send({ rating: 5 })).status).toBe(403)
  })

  it('refuses drafts and sessions of another conference', async () => {
    const draft = await createSessionDirect(conferenceId, { title: 'Draft', roomName: 'Hall D', startsAt: new Date(Date.now() - MIN), endsAt: new Date(Date.now() + MIN), status: 'draft' })
    const other = await createConference()
    const foreign = await createSessionDirect(other, { title: 'Foreign', startsAt: new Date(Date.now() - MIN), endsAt: new Date(Date.now() + MIN) })
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await request(app).put(`${base()}/audience/sessions/${draft}/rating`).set('Cookie', cookie).send({ rating: 3 })).status).toBe(404)
    expect((await request(app).put(`${base()}/audience/sessions/${foreign}/rating`).set('Cookie', cookie).send({ rating: 3 })).status).toBe(404)
  })
})

describe('organiser view', () => {
  async function seed() {
    const named = await createAudienceMember(conferenceId, 'named@example.com', { fullName: 'Named Person' })
    const anon = await createAudienceMember(conferenceId, 'anon@example.com', { fullName: 'Secret Person' })
    await request(app).put(`${base()}/audience/feedback`).set('Cookie', named.cookie).send({ rating: 5, liked: 'Venue' })
    await request(app).put(`${base()}/audience/feedback`).set('Cookie', anon.cookie).send({ rating: 2, improve: 'Wifi', is_anonymous: true })
    await request(app).put(`${base()}/audience/sessions/${startedId}/rating`).set('Cookie', named.cookie).send({ rating: 4, comment: 'Useful' })
    await request(app).put(`${base()}/audience/sessions/${startedId}/rating`).set('Cookie', anon.cookie).send({ rating: 2, is_anonymous: true })
  }

  it('averages, distribution, per-session table, anonymity respected', async () => {
    await seed()
    const res = await request(app).get(`${base()}/audience-feedback`).set('Cookie', await organiserCookie())
    expect(res.status).toBe(200)
    expect(res.body.conference).toEqual({ count: 2, average: 3.5, distribution: [0, 1, 0, 0, 1] })
    const started = res.body.sessions.find((s: { session_id: string }) => s.session_id === startedId)
    expect(started).toMatchObject({ count: 2, average: 3, distribution: [0, 1, 0, 1, 0] })
    expect(res.body.sessions.find((s: { session_id: string }) => s.session_id === futureId).count).toBe(0)
    expect(JSON.stringify(res.body)).not.toContain('Secret Person')
    expect(JSON.stringify(res.body)).not.toContain('anon@example.com')
    expect(res.body.items.some((i: { author_name: string | null }) => i.author_name === 'Named Person')).toBe(true)
  })

  it('filters comments by type, session, rating and text', async () => {
    await seed()
    const cookie = await organiserCookie()
    const get = async (q: Record<string, string>) => (await request(app).get(`${base()}/audience-feedback`).query(q).set('Cookie', cookie)).body.items
    expect(await get({ kind: 'session' })).toHaveLength(2)
    expect(await get({ kind: 'conference', rating: '2' })).toHaveLength(1)
    expect(await get({ session_id: startedId, with_comment: 'true' })).toHaveLength(1)
    expect((await get({ q: 'wifi' }))[0].text).toMatch(/Improve: Wifi/)
  })

  it('hide and delete are audit-logged; hidden rows leave the averages; deleted rows are gone', async () => {
    await seed()
    const cookie = await organiserCookie()
    const items = (await request(app).get(`${base()}/audience-feedback`).set('Cookie', cookie)).body.items as Array<{ kind: string; id: string; rating: number }>
    const low = items.find((i) => i.kind === 'conference' && i.rating === 2)!
    expect((await request(app).patch(`${base()}/audience-feedback/conference/${low.id}`).set('Cookie', cookie).send({ status: 'hidden' })).status).toBe(200)
    const afterHide = (await request(app).get(`${base()}/audience-feedback`).set('Cookie', cookie)).body
    expect(afterHide.conference.average).toBe(5)
    expect(afterHide.items.find((i: { id: string }) => i.id === low.id).status).toBe('hidden')

    const rating = items.find((i) => i.kind === 'session')!
    expect((await request(app).delete(`${base()}/audience-feedback/session/${rating.id}`).set('Cookie', cookie)).status).toBe(200)
    const afterDelete = (await request(app).get(`${base()}/audience-feedback`).set('Cookie', cookie)).body
    expect(afterDelete.items.find((i: { id: string }) => i.id === rating.id)).toBeUndefined()
    expect((await request(app).delete(`${base()}/audience-feedback/session/${rating.id}`).set('Cookie', cookie)).status).toBe(404)

    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE conference_id = ? AND action LIKE 'feedback.%' ORDER BY occurred_at`, [conferenceId])
    expect((audit as Array<{ action: string }>).map((a) => a.action)).toEqual(['feedback.moderated', 'feedback.deleted'])
  })

  it('a deleted rating cannot be re-submitted by its author', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    await request(app).put(`${base()}/audience/sessions/${startedId}/rating`).set('Cookie', cookie).send({ rating: 1, comment: 'spam' })
    const org = await organiserCookie()
    const items = (await request(app).get(`${base()}/audience-feedback`).set('Cookie', org)).body.items
    await request(app).delete(`${base()}/audience-feedback/session/${items[0].id}`).set('Cookie', org)
    expect((await request(app).put(`${base()}/audience/sessions/${startedId}/rating`).set('Cookie', cookie).send({ rating: 1 })).status).toBe(403)
  })

  it('CSV export respects anonymity and neutralises formulas', async () => {
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com', { fullName: 'Formula Fan' })
    await request(app).put(`${base()}/audience/feedback`).set('Cookie', cookie).send({ rating: 3, comments: '=HYPERLINK("x")', is_anonymous: true })
    const res = await request(app).get(`${base()}/audience-feedback/export.csv`).set('Cookie', await organiserCookie('manager'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.text).toContain('"Anonymous"')
    expect(res.text).not.toContain('Formula Fan')
    expect(res.text).toContain(`"Comments: =HYPERLINK(""x"")"`)
  })

  it('a session chair sees only their own sessions, no conference feedback, and cannot moderate', async () => {
    await seed()
    const chair = await createUser({ email: 'chair@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, chair, 'session_chair')
    await pool.query(`INSERT INTO session_chairs (session_id, user_id, chair_role) VALUES (?, ?, 'chair')`, [futureId, chair])
    const cookie = await createDirectSession(chair, conferenceId)
    const res = await request(app).get(`${base()}/audience-feedback`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.scope).toBe('chair')
    expect(res.body.conference).toBeNull()
    expect(res.body.sessions.map((s: { session_id: string }) => s.session_id)).toEqual([futureId])
    expect(res.body.items).toEqual([]) // the ratings are on the other session
    const anyId = (await pool.query(`SELECT id FROM session_ratings LIMIT 1`))[0] as Array<{ id: string }>
    expect((await request(app).patch(`${base()}/audience-feedback/session/${anyId[0]!.id}`).set('Cookie', cookie).send({ status: 'hidden' })).status).toBe(403)
  })

  it('Audience members, staff and reviewers cannot read feedback', async () => {
    await seed()
    const { cookie } = await createAudienceMember(conferenceId, 'reader@example.com')
    expect((await request(app).get(`${base()}/audience-feedback`).set('Cookie', cookie)).status).toBe(403)
    expect((await request(app).get(`${base()}/audience-feedback/export.csv`).set('Cookie', cookie)).status).toBe(403)
    for (const role of ['staff', 'reviewer']) {
      expect((await request(app).get(`${base()}/audience-feedback`).set('Cookie', await organiserCookie(role))).status).toBe(403)
    }
  })
})
