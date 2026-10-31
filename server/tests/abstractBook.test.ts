import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { collectBookGroups } from '../src/modules/abstractBook/service.js'
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
import { countPdfPages } from './pdfUtils.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

/** Supertest buffers a binary body only when asked to. */
function binary(res: request.Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => callback(null, Buffer.concat(chunks)))
}

async function seed() {
  const conferenceId = await createConference()
  const trackA = await createTrack(conferenceId, 'Climate')
  const trackB = await createTrack(conferenceId, 'Energy')
  const authorId = await createUser({ email: 'book-author@example.com', password: 'Str0ng!Pass' })
  const accepted1 = await createSubmission(conferenceId, trackA, authorId, { title: 'Accepted climate paper', status: 'accepted' })
  const accepted2 = await createSubmission(conferenceId, trackB, authorId, { title: 'Accepted energy paper', status: 'final_approved' })
  const underReview = await createSubmission(conferenceId, trackA, authorId, { title: 'Still under review paper', status: 'under_review' })
  const rejected = await createSubmission(conferenceId, trackA, authorId, { title: 'Rejected paper', status: 'rejected' })
  for (const id of [accepted1, accepted2, underReview, rejected]) {
    await addSubmissionAuthor(id, { fullName: 'Sita Sharma', email: 'book-author@example.com', userId: authorId, order: 1 })
  }
  const convenorId = await createUser({ email: 'book-convenor@example.com', password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, convenorId, 'convenor')
  return { conferenceId, accepted1, accepted2, convenorCookie: await createDirectSession(convenorId) }
}

describe('book of abstracts', () => {
  it('includes only accepted abstracts by default, never rejected ones', async () => {
    const { conferenceId } = await seed()
    const accepted = await collectBookGroups(conferenceId, { only_accepted: true, order: 'track' })
    expect(accepted.map((g) => g.heading)).toEqual(['Climate', 'Energy'])
    expect(accepted.flatMap((g) => g.abstracts.map((a) => a.title))).toEqual(['Accepted climate paper', 'Accepted energy paper'])
    expect(accepted[0]!.abstracts[0]!.authors[0]).toMatchObject({ full_name: 'Sita Sharma', presenting: true })

    const all = await collectBookGroups(conferenceId, { only_accepted: false, order: 'title' })
    expect(all[0]!.abstracts.map((a) => a.title)).toEqual(['Accepted climate paper', 'Accepted energy paper', 'Still under review paper'])
  })

  it('generates a PDF with the expected page count for the seeded data and stores it', async () => {
    const { conferenceId, convenorCookie } = await seed()
    const gen = await request(app)
      .post(`/api/conferences/${conferenceId}/abstract-book/generate`)
      .set('Cookie', convenorCookie)
      .send({ only_accepted: true, order: 'track' })
    expect(gen.status).toBe(200)
    // cover + contents + 2 abstracts + author index
    expect(gen.body.book).toMatchObject({ abstract_count: 2, page_count: 5, is_published: false })

    const file = await request(app)
      .get(`/api/conferences/${conferenceId}/abstract-book/download`)
      .set('Cookie', convenorCookie)
      .buffer(true)
      .parse(binary)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toContain('application/pdf')
    expect(countPdfPages(file.body as Buffer)).toBe(5)

    const [audit] = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'abstract_book.generate' AND conference_id = ?`, [conferenceId])
    expect((audit as unknown[]).length).toBe(1)
  })

  it('orders by session once the programme is published, with unscheduled papers last', async () => {
    const { conferenceId, accepted2 } = await seed()
    const sessionId = await createSessionDirect(conferenceId, {
      title: 'Energy session',
      startsAt: new Date('2026-11-15T03:15:00Z'),
      endsAt: new Date('2026-11-15T04:15:00Z'),
    })
    await pool.query(
      `INSERT INTO presentations (conference_id, session_id, submission_id, starts_at, ends_at, presentation_order)
       VALUES (?, ?, ?, '2026-11-15 03:15:00', '2026-11-15 03:30:00', 1)`,
      [conferenceId, sessionId, accepted2],
    )
    const groups = await collectBookGroups(conferenceId, { only_accepted: true, order: 'session' })
    expect(groups.map((g) => g.heading)).toEqual(['Energy session', 'Not in the programme'])
    expect(groups[1]!.abstracts.map((a) => a.title)).toEqual(['Accepted climate paper'])
  })

  it('re-generating replaces the file and keeps the publish toggle; public download only while published', async () => {
    const { conferenceId, convenorCookie } = await seed()
    const generate = (body: object) =>
      request(app).post(`/api/conferences/${conferenceId}/abstract-book/generate`).set('Cookie', convenorCookie).send(body)

    expect((await request(app).get(`/api/conferences/${conferenceId}/abstract-book/public.pdf`)).status).toBe(404)
    // Can't publish what doesn't exist yet.
    expect(
      (await request(app).patch(`/api/conferences/${conferenceId}/abstract-book/publish`).set('Cookie', convenorCookie).send({ is_published: true }))
        .status,
    ).toBe(404)

    await generate({ only_accepted: true, order: 'track' })
    expect((await request(app).get(`/api/conferences/${conferenceId}/abstract-book/public`)).body.available).toBe(false)
    expect((await request(app).get(`/api/conferences/${conferenceId}/abstract-book/public.pdf`)).status).toBe(404)

    const publish = await request(app)
      .patch(`/api/conferences/${conferenceId}/abstract-book/publish`)
      .set('Cookie', convenorCookie)
      .send({ is_published: true })
    expect(publish.status).toBe(200)
    expect((await request(app).get(`/api/conferences/${conferenceId}/abstract-book/public`)).body.available).toBe(true)
    expect((await request(app).get(`/api/conferences/${conferenceId}/abstract-book/public.pdf`)).status).toBe(200)

    const [before] = await pool.query('SELECT file_path FROM abstract_books WHERE conference_id = ?', [conferenceId])
    const regen = await generate({ only_accepted: false, order: 'title' })
    expect(regen.body.book).toMatchObject({ abstract_count: 3, is_published: true, options: { only_accepted: false, order: 'title' } })
    const [after] = await pool.query('SELECT file_path FROM abstract_books WHERE conference_id = ?', [conferenceId])
    expect((after as Array<{ file_path: string }>)[0]!.file_path).not.toBe((before as Array<{ file_path: string }>)[0]!.file_path)
  })

  it('only schedule.manage holders can generate or download it (401/403)', async () => {
    const { conferenceId } = await seed()
    expect((await request(app).post(`/api/conferences/${conferenceId}/abstract-book/generate`).send({})).status).toBe(401)

    const reviewerId = await createUser({ email: 'book-reviewer@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewerId, 'reviewer')
    const cookie = await createDirectSession(reviewerId)
    expect((await request(app).post(`/api/conferences/${conferenceId}/abstract-book/generate`).set('Cookie', cookie).send({})).status).toBe(403)
    expect((await request(app).get(`/api/conferences/${conferenceId}/abstract-book/download`).set('Cookie', cookie)).status).toBe(403)
    expect((await request(app).get(`/api/conferences/${conferenceId}/abstract-book`).set('Cookie', cookie)).status).toBe(403)
  })
})
