import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { withTransaction } from '../src/db/withTransaction.js'
import {
  addConferenceMember,
  createConference,
  createDirectSession,
  createTrack,
  createUser,
  exeBuffer,
  jpgBuffer,
  oversizedBuffer,
  pdfBuffer,
  pngBuffer,
  resetDatabase,
  setDeadlineWindow,
  upsertConferenceSettings,
} from './helpers.js'

const app = createApp()

/** Walks a submission through a chain of valid statuses (the DB trigger only allows specific hops, see 03_triggers.sql). */
async function forceStatusPath(id: string, ...path: string[]) {
  for (const status of path) {
    await withTransaction(null, async (conn) => {
      await conn.query(`UPDATE submissions SET status = ? WHERE id = ?`, [status, id])
    })
  }
}

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

/**
 * A thin stand-in for a logged-in supertest agent, authenticated via a
 * directly-created session rather than POST /api/auth/login — that endpoint
 * is rate-limited to 20 attempts / 15 min shared across this whole file,
 * which this suite's test count would otherwise exceed. requireAuth only
 * ever consults the session row, so this is behaviourally identical.
 */
function cookieAgent(cookie: string) {
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAsAuthor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'author')
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

describe('A1 author form', () => {
  it('returns only active tracks for an active member', async () => {
    const conferenceId = await createConference()
    await createTrack(conferenceId, 'Active track', true)
    await createTrack(conferenceId, 'Inactive track', false)
    await pool.query('UPDATE conferences SET submission_guidelines = ? WHERE id = ?', ['Use the **template**.', conferenceId])
    const { agent } = await loginAsAuthor(conferenceId, 'author-form@example.com')

    const res = await agent.get(`/api/conferences/${conferenceId}/author-form`)
    expect(res.status).toBe(200)
    expect(res.body.tracks).toHaveLength(1)
    expect(res.body.tracks[0].name).toBe('Active track')
    expect(res.body.settings.max_abstract_words).toBe(300)
    expect(res.body.submission_guidelines).toBe('Use the **template**.')
  })

  it('is forbidden for a non-member', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'non-member@example.com', password: 'Str0ng!Pass' })
    const cookie = await createDirectSession(userId)

    const res = await cookieAgent(cookie).get(`/api/conferences/${conferenceId}/author-form`)
    expect(res.status).toBe(403)
  })

  it('is unauthorized when logged out', async () => {
    const conferenceId = await createConference()
    const res = await request(app).get(`/api/conferences/${conferenceId}/author-form`)
    expect(res.status).toBe(401)
  })
})

describe('A2 create / edit / submit', () => {
  it('creates a draft, edits it, and submits it inside the window with a sequential code', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await setDeadlineWindow(conferenceId, 'abstract_submission', -1, 24)
    const { agent } = await loginAsAuthor(conferenceId, 'create-submit@example.com')

    const create = await agent.post(`/api/conferences/${conferenceId}/submissions`).send({
      track_id: trackId,
      title: 'A Title Long Enough',
      abstract: 'This is my abstract.',
      keywords: ['ai'],
      presentation_preference: 'oral',
    })
    expect(create.status).toBe(201)
    const id = create.body.id

    const edit = await agent.patch(`/api/submissions/${id}`).send({ title: 'An Updated Title' })
    expect(edit.status).toBe(200)
    expect(edit.body.title).toBe('An Updated Title')

    const submit = await agent.post(`/api/submissions/${id}/submit`)
    expect(submit.status).toBe(200)
    expect(submit.body.status).toBe('submitted')
    expect(submit.body.submission_code).toMatch(/-0001$/)

    const [historyRows] = await pool.query('SELECT to_status FROM submission_status_history WHERE submission_id = ? ORDER BY id', [id])
    expect((historyRows as Array<{ to_status: string }>).map((r) => r.to_status)).toEqual(['draft', 'submitted'])
  })

  it('assigns sequential codes to two submissions in the same conference', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await setDeadlineWindow(conferenceId, 'abstract_submission', -1, 24)
    const { agent } = await loginAsAuthor(conferenceId, 'sequential@example.com')

    const codes: string[] = []
    for (const title of ['First Submission Title', 'Second Submission Title']) {
      const create = await agent
        .post(`/api/conferences/${conferenceId}/submissions`)
        .send({ track_id: trackId, title, abstract: 'Abstract text.', keywords: [], presentation_preference: 'either' })
      const submit = await agent.post(`/api/submissions/${create.body.id}/submit`)
      codes.push(submit.body.submission_code)
    }
    expect(codes[0]).not.toBe(codes[1])
    expect(codes[0]!.endsWith('-0001')).toBe(true)
    expect(codes[1]!.endsWith('-0002')).toBe(true)
  })

  it('rejects an abstract over the word limit', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await upsertConferenceSettings(conferenceId, { max_abstract_words: 50 })
    const { agent } = await loginAsAuthor(conferenceId, 'wordlimit@example.com')

    const res = await agent.post(`/api/conferences/${conferenceId}/submissions`).send({
      track_id: trackId,
      title: 'A Title Long Enough',
      abstract: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '),
      keywords: [],
      presentation_preference: 'either',
    })
    expect(res.status).toBe(400)
  })

  it('rejects a track from another conference', async () => {
    const conferenceId = await createConference()
    const otherConferenceId = await createConference({ slug: 'other-conf-subs' })
    const otherTrackId = await createTrack(otherConferenceId, 'Other Track')
    const { agent } = await loginAsAuthor(conferenceId, 'other-track@example.com')

    const res = await agent.post(`/api/conferences/${conferenceId}/submissions`).send({
      track_id: otherTrackId,
      title: 'A Title Long Enough',
      abstract: 'Abstract text.',
      keywords: [],
      presentation_preference: 'either',
    })
    expect(res.status).toBe(400)
  })

  it('rejects submitting outside the abstract submission window', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    // No window configured at all.
    const { agent } = await loginAsAuthor(conferenceId, 'no-window@example.com')

    const create = await agent
      .post(`/api/conferences/${conferenceId}/submissions`)
      .send({ track_id: trackId, title: 'A Title Long Enough', abstract: 'Abstract.', keywords: [], presentation_preference: 'either' })
    const submit = await agent.post(`/api/submissions/${create.body.id}/submit`)
    expect(submit.status).toBe(409)
  })
})

describe('A2 ownership', () => {
  it('hides another author\'s submission as 404', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent: ownerAgent } = await loginAsAuthor(conferenceId, 'owner@example.com')
    const { agent: otherAgent } = await loginAsAuthor(conferenceId, 'intruder@example.com')

    const create = await ownerAgent
      .post(`/api/conferences/${conferenceId}/submissions`)
      .send({ track_id: trackId, title: 'A Private Title', abstract: 'Abstract.', keywords: [], presentation_preference: 'either' })

    const getRes = await otherAgent.get(`/api/submissions/${create.body.id}`)
    expect(getRes.status).toBe(404)

    const patchRes = await otherAgent.patch(`/api/submissions/${create.body.id}`).send({ title: 'Hacked title' })
    expect(patchRes.status).toBe(404)
  })
})

describe('A2 co-authors', () => {
  it('requires an account for a corresponding co-author and keeps only one corresponding author', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent } = await loginAsAuthor(conferenceId, 'coauthor-owner@example.com')
    await createUser({ email: 'has-account@example.com', password: 'Str0ng!Pass' })

    const create = await agent
      .post(`/api/conferences/${conferenceId}/submissions`)
      .send({ track_id: trackId, title: 'A Title Long Enough', abstract: 'Abstract.', keywords: [], presentation_preference: 'either' })
    const id = create.body.id

    const noAccount = await agent.post(`/api/submissions/${id}/authors`).send({
      full_name: 'No Account',
      email: 'no-account@example.com',
      is_corresponding: true,
    })
    expect(noAccount.status).toBe(400)

    const withAccount = await agent.post(`/api/submissions/${id}/authors`).send({
      full_name: 'Has Account',
      email: 'has-account@example.com',
      is_corresponding: true,
    })
    expect(withAccount.status).toBe(201)

    const [rows] = await pool.query(
      'SELECT email, is_corresponding FROM submission_authors WHERE submission_id = ? ORDER BY author_order',
      [id],
    )
    const authors = rows as Array<{ email: string; is_corresponding: number }>
    expect(authors.filter((a) => a.is_corresponding)).toHaveLength(1)
    expect(authors.find((a) => a.is_corresponding)?.email).toBe('has-account@example.com')
  })

  it('refuses to delete the corresponding author or the last author', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent } = await loginAsAuthor(conferenceId, 'coauthor-del@example.com')

    const create = await agent
      .post(`/api/conferences/${conferenceId}/submissions`)
      .send({ track_id: trackId, title: 'A Title Long Enough', abstract: 'Abstract.', keywords: [], presentation_preference: 'either' })
    const id = create.body.id

    const [rows] = await pool.query('SELECT id FROM submission_authors WHERE submission_id = ?', [id])
    const correspondingAuthorId = (rows as Array<{ id: string }>)[0]!.id

    const lastAuthorDelete = await agent.delete(`/api/submissions/${id}/authors/${correspondingAuthorId}`)
    expect(lastAuthorDelete.status).toBe(400)
  })
})

describe('A3 files', () => {
  async function createDraft(agent: request.Agent, conferenceId: string, trackId: string) {
    const create = await agent
      .post(`/api/conferences/${conferenceId}/submissions`)
      .send({ track_id: trackId, title: 'A Title Long Enough', abstract: 'Abstract.', keywords: [], presentation_preference: 'either' })
    return create.body.id as string
  }

  it('accepts a valid PDF for the abstract kind and never exposes storage_path', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent } = await loginAsAuthor(conferenceId, 'files-pdf@example.com')
    const id = await createDraft(agent, conferenceId, trackId)

    const res = await agent
      .post(`/api/submissions/${id}/files/abstract`)
      .attach('file', pdfBuffer(), { filename: 'abstract.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(201)
    expect(res.body.file_kind).toBe('abstract')

    const detail = await agent.get(`/api/submissions/${id}`)
    expect(detail.body.files).toHaveLength(1)
    expect(detail.body.files[0].storage_path).toBeUndefined()
  })

  it('rejects a text file renamed to .pdf', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent } = await loginAsAuthor(conferenceId, 'files-fake@example.com')
    const id = await createDraft(agent, conferenceId, trackId)

    const res = await agent
      .post(`/api/submissions/${id}/files/abstract`)
      .attach('file', Buffer.from('plain text content'), { filename: 'abstract.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(400)
  })

  it('accepts an image for abstract but rejects it for full_paper', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent } = await loginAsAuthor(conferenceId, 'files-image@example.com')
    const id = await createDraft(agent, conferenceId, trackId)

    const okRes = await agent
      .post(`/api/submissions/${id}/files/abstract`)
      .attach('file', await pngBuffer(), { filename: 'abstract.png', contentType: 'image/png' })
    expect(okRes.status).toBe(201)

    await forceStatusPath(id, 'submitted', 'accepted')
    await setDeadlineWindow(conferenceId, 'full_paper', -1, 24)
    const badRes = await agent
      .post(`/api/submissions/${id}/files/full_paper`)
      .attach('file', await jpgBuffer(), { filename: 'paper.jpg', contentType: 'image/jpeg' })
    expect(badRes.status).toBe(400)
  })

  it('rejects an oversized file', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await upsertConferenceSettings(conferenceId, { max_file_size_mb: 1 })
    const { agent } = await loginAsAuthor(conferenceId, 'files-big@example.com')
    const id = await createDraft(agent, conferenceId, trackId)

    const res = await agent
      .post(`/api/submissions/${id}/files/abstract`)
      .attach('file', oversizedBuffer(2 * 1024 * 1024), { filename: 'big.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(400)
  })

  it('refuses a .exe renamed to .pdf', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent } = await loginAsAuthor(conferenceId, 'files-exe@example.com')
    const id = await createDraft(agent, conferenceId, trackId)

    const res = await agent
      .post(`/api/submissions/${id}/files/abstract`)
      .attach('file', exeBuffer(), { filename: 'virus.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(400)
  })

  it('allows the owner to download but refuses an unrelated author', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent: ownerAgent } = await loginAsAuthor(conferenceId, 'download-owner@example.com')
    const { agent: otherAgent } = await loginAsAuthor(conferenceId, 'download-other@example.com')
    const id = await createDraft(ownerAgent, conferenceId, trackId)

    const upload = await ownerAgent
      .post(`/api/submissions/${id}/files/abstract`)
      .attach('file', pdfBuffer(), { filename: 'abstract.pdf', contentType: 'application/pdf' })
    const fileId = upload.body.id

    const ownerDownload = await ownerAgent.get(`/api/submissions/${id}/files/${fileId}/download`)
    expect(ownerDownload.status).toBe(200)

    const otherDownload = await otherAgent.get(`/api/submissions/${id}/files/${fileId}/download`)
    expect(otherDownload.status).toBe(403)
  })

  it('moves accepted/full_paper_pending to full_paper_submitted on the first full paper upload', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    await setDeadlineWindow(conferenceId, 'full_paper', -1, 24)
    const { agent } = await loginAsAuthor(conferenceId, 'fullpaper@example.com')
    const id = await createDraft(agent, conferenceId, trackId)

    const beforeAccept = await agent
      .post(`/api/submissions/${id}/files/full_paper`)
      .attach('file', pdfBuffer(), { filename: 'paper.pdf', contentType: 'application/pdf' })
    expect(beforeAccept.status).toBe(400)

    await forceStatusPath(id, 'submitted', 'accepted')
    const afterAccept = await agent
      .post(`/api/submissions/${id}/files/full_paper`)
      .attach('file', pdfBuffer(), { filename: 'paper.pdf', contentType: 'application/pdf' })
    expect(afterAccept.status).toBe(201)

    const [rows] = await pool.query('SELECT status FROM submissions WHERE id = ?', [id])
    expect((rows as Array<{ status: string }>)[0]!.status).toBe('full_paper_submitted')
  })
})

describe('A2 delete / withdraw', () => {
  it('deletes a draft, but refuses once a review is in progress', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent, userId } = await loginAsAuthor(conferenceId, 'delete@example.com')

    const create1 = await agent
      .post(`/api/conferences/${conferenceId}/submissions`)
      .send({ track_id: trackId, title: 'Draft To Delete', abstract: 'Abstract.', keywords: [], presentation_preference: 'either' })
    const delRes = await agent.delete(`/api/submissions/${create1.body.id}`)
    expect(delRes.status).toBe(200)

    const create2 = await agent
      .post(`/api/conferences/${conferenceId}/submissions`)
      .send({ track_id: trackId, title: 'Under Review Submission', abstract: 'Abstract.', keywords: [], presentation_preference: 'either' })
    const id2 = create2.body.id
    await forceStatusPath(id2, 'submitted', 'under_review')
    const reviewerId = await createUser({ email: 'reviewer-block@example.com', password: 'Str0ng!Pass' })
    await pool.query(
      `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, status, due_at)
       VALUES (?, ?, ?, 1, 'in_progress', DATE_ADD(NOW(3), INTERVAL 1 DAY))`,
      [conferenceId, id2, reviewerId],
    )
    const blockedDelete = await agent.delete(`/api/submissions/${id2}`)
    expect(blockedDelete.status).toBe(409)
    void userId
  })

  it('withdraws a submission and records history with the reason', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track A')
    const { agent } = await loginAsAuthor(conferenceId, 'withdraw@example.com')

    const create = await agent
      .post(`/api/conferences/${conferenceId}/submissions`)
      .send({ track_id: trackId, title: 'To Withdraw', abstract: 'Abstract.', keywords: [], presentation_preference: 'either' })
    const id = create.body.id

    const withdraw = await agent.post(`/api/submissions/${id}/withdraw`).send({ reason: 'Changed my mind' })
    expect(withdraw.status).toBe(200)
    expect(withdraw.body.status).toBe('withdrawn')

    const [rows] = await pool.query(
      `SELECT to_status, reason FROM submission_status_history WHERE submission_id = ? ORDER BY id DESC LIMIT 1`,
      [id],
    )
    const row = (rows as Array<{ to_status: string; reason: string | null }>)[0]!
    expect(row.to_status).toBe('withdrawn')
    expect(row.reason).toBe('Changed my mind')
  })
})
