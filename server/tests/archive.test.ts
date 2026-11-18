import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { savePrivateFile } from '../src/storage/privateFileStore.js'
import {
  addConferenceMember,
  addSubmissionAuthor,
  createConference,
  createDirectSession,
  createSubmission,
  createTrack,
  createUser,
  pdfBuffer,
  resetDatabase,
} from './helpers.js'

/** changes-nov2, Part 3: public archive of an ended conference and the conference report. */
const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function convenorFor(conferenceId: string, email = 'arch-convenor@example.com') {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const cookie = await createDirectSession(userId, conferenceId)
  return {
    userId,
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    put: (url: string) => request(app).put(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
  }
}

async function endConference(conferenceId: string) {
  await pool.query(
    `UPDATE conferences SET start_date = DATE_SUB(CURDATE(), INTERVAL 5 DAY), end_date = DATE_SUB(CURDATE(), INTERVAL 2 DAY) WHERE id = ?`,
    [conferenceId],
  )
}

async function addFinalPaper(submissionId: string, uploaderId: string) {
  const key = `submissions/${submissionId}/camera_ready-v1-test.pdf`
  await savePrivateFile(key, pdfBuffer())
  await pool.query(
    `INSERT INTO submission_files (submission_id, file_kind, version, storage_path, original_filename, mime_type, size_bytes, is_final, uploaded_by)
     VALUES (?, 'camera_ready', 1, ?, 'final.pdf', 'application/pdf', ?, TRUE, ?)`,
    [submissionId, key, pdfBuffer().length, uploaderId],
  )
}

describe('public archive', () => {
  it('is empty while the conference is running', async () => {
    const conferenceId = await createConference()
    const res = await request(app).get(`/api/conferences/${conferenceId}/archive`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ended: false, tracks: [], papers: [], report: null })
  })

  it('lists only final-approved-or-later papers, with names but never emails, reviews or scores', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track Archive')
    const convenor = await convenorFor(conferenceId)
    const shown = await createSubmission(conferenceId, trackId, convenor.userId, { status: 'presented', title: 'A presented paper' })
    await addSubmissionAuthor(shown, { fullName: 'Asha Author', email: 'asha.secret@example.com', isCorresponding: false })
    for (const status of ['draft', 'rejected', 'withdrawn', 'under_review', 'accepted']) {
      await createSubmission(conferenceId, trackId, convenor.userId, { status, title: `Hidden ${status} paper` })
    }
    await endConference(conferenceId)

    const res = await request(app).get(`/api/conferences/${conferenceId}/archive`)
    expect(res.status).toBe(200)
    expect(res.body.ended).toBe(true)
    expect(res.body.papers.map((p: { title: string }) => p.title)).toEqual(['A presented paper'])
    expect(res.body.papers[0].presenters).toEqual(['Asha Author'])
    expect(res.body.papers[0].download_url).toBeNull() // not marked Published
    const json = JSON.stringify(res.body)
    expect(json).not.toContain('asha.secret@example.com')
    expect(json).not.toMatch(/score|recommendation|confidential/i)
  })

  it('offers a signed download only for a Published paper; tampered or unpublished links are refused', async () => {
    const conferenceId = await createConference()
    const trackId = await createTrack(conferenceId, 'Track D')
    const convenor = await convenorFor(conferenceId)
    const sid = await createSubmission(conferenceId, trackId, convenor.userId, { status: 'final_approved', title: 'Downloadable paper' })
    await addFinalPaper(sid, convenor.userId)
    await convenor.put(`/api/conferences/${conferenceId}/submissions/${sid}/publication`).send({ is_published: true, doi_or_link: '10.1234/x' })
    await endConference(conferenceId)

    const archive = await request(app).get(`/api/conferences/${conferenceId}/archive`)
    const url = archive.body.papers[0].download_url as string
    expect(url).toMatch(/\/archive\/papers\/.+\/file\?expires=\d+&sig=/)
    expect(archive.body.papers[0].publication.doi_or_link).toBe('10.1234/x')

    const ok = await request(app).get(url)
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toContain('pdf')

    const tampered = await request(app).get(url.replace(/sig=[^&]+/, 'sig=forged'))
    expect(tampered.status).toBe(403)

    await convenor.put(`/api/conferences/${conferenceId}/submissions/${sid}/publication`).send({ is_published: false })
    expect((await request(app).get(url)).status).toBe(404)
  })
})

describe('conference report', () => {
  it('convenor writes, uploads a PDF, publishes and unpublishes; public sees it only while published', async () => {
    const conferenceId = await createConference()
    const convenor = await convenorFor(conferenceId, 'report-convenor@example.com')
    await endConference(conferenceId)

    expect((await convenor.post(`/api/conferences/${conferenceId}/conference-report/publish`)).status).toBe(409) // nothing written yet

    expect((await convenor.put(`/api/conferences/${conferenceId}/conference-report`).send({ body_text: 'Thank you <script>x</script>all.' })).status).toBe(200)
    const notPdf = await convenor.post(`/api/conferences/${conferenceId}/conference-report/pdf`).attach('file', Buffer.from('hello'), 'fake.pdf')
    expect(notPdf.status).toBe(400)
    const upload = await convenor.post(`/api/conferences/${conferenceId}/conference-report/pdf`).attach('file', pdfBuffer(), 'report.pdf')
    expect(upload.status).toBe(201)

    expect((await request(app).get(`/api/conferences/${conferenceId}/archive`)).body.report).toBeNull()
    expect((await request(app).get(`/api/conferences/${conferenceId}/archive/report.pdf`)).status).toBe(404)

    expect((await convenor.post(`/api/conferences/${conferenceId}/conference-report/publish`)).status).toBe(200)
    const report = (await convenor.get(`/api/conferences/${conferenceId}/conference-report`)).body.report
    expect(report).toMatchObject({ is_published: true, has_pdf: true, published_by_name: expect.any(String) })
    expect(report.published_at).toBeTruthy()

    const publicArchive = await request(app).get(`/api/conferences/${conferenceId}/archive`)
    expect(publicArchive.body.report).toMatchObject({ body_text: 'Thank you xall.', has_pdf: true })
    expect((await request(app).get(`/api/conferences/${conferenceId}/archive/report.pdf`)).status).toBe(200)

    expect((await convenor.post(`/api/conferences/${conferenceId}/conference-report/unpublish`)).status).toBe(200)
    expect((await request(app).get(`/api/conferences/${conferenceId}/archive`)).body.report).toBeNull()

    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE entity_type = 'conference_reports' AND entity_id = ? ORDER BY id`, [conferenceId])
    expect((audit as Array<{ action: string }>).map((a) => a.action)).toEqual([
      'conference_report.save',
      'conference_report.upload_pdf',
      'conference_report.publish',
      'conference_report.unpublish',
    ])
  })

  it('refuses report changes without conference.manage', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'report-author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, userId, 'author')
    const cookie = await createDirectSession(userId, conferenceId)
    const res = await request(app).put(`/api/conferences/${conferenceId}/conference-report`).set('Cookie', cookie).send({ body_text: 'x' })
    expect(res.status).toBe(403)
  })
})
