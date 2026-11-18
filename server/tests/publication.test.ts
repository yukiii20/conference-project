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

/** changes-nov2, Part 4: publication information (conference level and per paper). */
const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function agentFor(conferenceId: string, email: string, role: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, role)
  const cookie = await createDirectSession(userId, conferenceId)
  return {
    userId,
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    put: (url: string) => request(app).put(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
  }
}

async function auditCount(action: string, entityId?: string): Promise<number> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM audit_logs WHERE action = ? ${entityId ? 'AND entity_id = ?' : ''}`,
    entityId ? [action, entityId] : [action],
  )
  return Number((rows as Array<{ n: number }>)[0]!.n)
}

describe('conference publication information', () => {
  it('is hidden publicly until filled, then shown; saving is audited', async () => {
    const conferenceId = await createConference()
    const convenor = await agentFor(conferenceId, 'pub-convenor@example.com', 'convenor')

    const empty = await request(app).get(`/api/conferences/${conferenceId}/publication-info/public`)
    expect(empty.status).toBe(200)
    expect(empty.body.publication).toBeNull()

    const save = await convenor.put(`/api/conferences/${conferenceId}/publication-info`).send({
      title: 'Proceedings of the Test Conference <b>2026</b>',
      publisher: 'Kathmandu Press',
      isbn_issn: '978-3-16-148410-0',
      link: '10.1234',
      date: '2027-01-15',
      note: 'Accepted papers will be published in the proceedings.',
    })
    expect(save.status).toBe(200)
    expect(await auditCount('publication_info.update', conferenceId)).toBe(1)

    const shown = await request(app).get(`/api/conferences/${conferenceId}/publication-info/public`)
    expect(shown.body.publication).toMatchObject({
      title: 'Proceedings of the Test Conference 2026', // tags stripped: plain text only
      publisher: 'Kathmandu Press',
      isbn_issn: '978-3-16-148410-0',
      link: '10.1234',
      date: '2027-01-15',
    })
  })

  it('rejects a bad link or ISBN, and anyone without conference.manage', async () => {
    const conferenceId = await createConference()
    const convenor = await agentFor(conferenceId, 'pub-convenor2@example.com', 'convenor')
    const bad = await convenor.put(`/api/conferences/${conferenceId}/publication-info`).send({ link: 'javascript:alert(1)', isbn_issn: 'abc' })
    expect(bad.status).toBe(400)

    const author = await agentFor(conferenceId, 'pub-author@example.com', 'author')
    expect((await author.put(`/api/conferences/${conferenceId}/publication-info`).send({ title: 'x' })).status).toBe(403)
  })
})

describe('paper publication', () => {
  it('convenor marks a final-approved paper as published; the author sees it in My submissions', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track P')
    const convenor = await agentFor(conferenceId, 'pp-convenor@example.com', 'convenor')
    const author = await agentFor(conferenceId, 'pp-author@example.com', 'author')
    const sid = await createSubmission(conferenceId, trackId, author.userId, { status: 'final_approved', title: 'A publishable paper' })
    await addSubmissionAuthor(sid, { fullName: 'Paper Author', email: 'pp-author@example.com', userId: author.userId })

    const res = await convenor.put(`/api/conferences/${conferenceId}/submissions/${sid}/publication`).send({
      is_published: true,
      published_in: 'Proceedings 2026',
      doi_or_link: '10.5555/abc.123',
      publication_date: '2027-01-15',
    })
    expect(res.status).toBe(200)
    expect(await auditCount('paper_publication.update', sid)).toBe(1)

    const mine = await author.get(`/api/conferences/${conferenceId}/my-submissions`)
    expect(mine.body.submissions[0]).toMatchObject({ is_published: true, published_in: 'Proceedings 2026', doi_or_link: '10.5555/abc.123' })
  })

  it('refuses publishing a paper that is not final approved', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track Q')
    const convenor = await agentFor(conferenceId, 'pp-convenor2@example.com', 'convenor')
    const sid = await createSubmission(conferenceId, trackId, convenor.userId, { status: 'under_review', title: 'Still under review' })
    const res = await convenor.put(`/api/conferences/${conferenceId}/submissions/${sid}/publication`).send({ is_published: true })
    expect(res.status).toBe(409)
  })

  it('"Publish all" publishes only final-approved-or-later papers, keeps existing values and audits each', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track B')
    const convenor = await agentFor(conferenceId, 'pp-bulk@example.com', 'convenor')
    await convenor.put(`/api/conferences/${conferenceId}/publication-info`).send({ title: 'Default Proceedings' })
    const a = await createSubmission(conferenceId, trackId, convenor.userId, { status: 'final_approved', title: 'Final approved one' })
    const b = await createSubmission(conferenceId, trackId, convenor.userId, { status: 'presented', title: 'Presented two' })
    const c = await createSubmission(conferenceId, trackId, convenor.userId, { status: 'rejected', title: 'Rejected three' })
    await convenor.put(`/api/conferences/${conferenceId}/submissions/${b}/publication`).send({ is_published: false, published_in: 'Special Issue' })

    const res = await convenor.post(`/api/conferences/${conferenceId}/paper-publications/publish-all`).send({})
    expect(res.status).toBe(200)
    expect(res.body.published).toBe(2)

    const list = await convenor.get(`/api/conferences/${conferenceId}/paper-publications`)
    const byId = new Map((list.body.papers as Array<{ submission_id: string; is_published: boolean; published_in: string }>).map((p) => [p.submission_id, p]))
    expect(byId.get(a)).toMatchObject({ is_published: true, published_in: 'Default Proceedings' })
    expect(byId.get(b)).toMatchObject({ is_published: true, published_in: 'Special Issue' })
    expect(byId.has(c)).toBe(false)
    const [bulk] = await pool.query(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'paper_publication.bulk_publish' AND conference_id = ?`, [conferenceId])
    expect(Number((bulk as Array<{ n: number }>)[0]!.n)).toBe(2)

    // Running it again changes nothing.
    expect((await convenor.post(`/api/conferences/${conferenceId}/paper-publications/publish-all`).send({})).body.published).toBe(0)
  })
})
