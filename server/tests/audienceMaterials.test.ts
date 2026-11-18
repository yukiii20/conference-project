import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { savePrivateFile } from '../src/storage/privateFileStore.js'
import {
  addConferenceMember,
  addSubmissionAuthor,
  createAudienceMember,
  createConference,
  createDirectSession,
  createSubmission,
  createTrack,
  createUser,
  resetDatabase,
  setAudienceSettings,
  upsertConferenceSettings,
} from './helpers.js'

/** Audience role, Phase 5: materials, consent-gated paper downloads, accepted abstracts, Audience settings. */
const app = createApp()
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')

let conferenceId = ''
let trackId = ''
const base = () => `/api/conferences/${conferenceId}`

async function convenorCookie(role = 'convenor'): Promise<string> {
  const u = await createUser({ email: `${role}@example.com`, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, u, role)
  return createDirectSession(u, conferenceId)
}

async function paperWithFiles(status: string, title: string, consent: { slides: boolean; paper: boolean }) {
  const author = await createUser({ email: `${title.replace(/\W/g, '').toLowerCase()}@example.com`, password: 'Str0ng!Pass', fullName: 'Paper Author' })
  await addConferenceMember(conferenceId, author, 'author')
  const id = await createSubmission(conferenceId, trackId, author, { title, status })
  await addSubmissionAuthor(id, { fullName: 'Paper Author', email: 'secret-author@example.com', userId: author })
  await pool.query('UPDATE submissions SET audience_slides_allowed = ?, audience_paper_allowed = ? WHERE id = ?', [consent.slides, consent.paper, id])
  for (const [kind, isFinal] of [['slides', false], ['camera_ready', true]] as const) {
    const path = `submissions/${id}/${kind}-v1-${Math.random().toString(36).slice(2, 8)}.pdf`
    await savePrivateFile(path, PDF)
    await pool.query(
      `INSERT INTO submission_files (submission_id, file_kind, version, storage_path, original_filename, mime_type, size_bytes, is_final, uploaded_by)
       VALUES (?, ?, 1, ?, ?, 'application/pdf', ?, ?, ?)`,
      [id, kind, path, `${kind}.pdf`, PDF.length, isFinal, author],
    )
  }
  return { id, authorCookie: await createDirectSession(author, conferenceId) }
}

beforeEach(async () => {
  await resetDatabase()
  conferenceId = await createConference({ status: 'registration_open' })
  await upsertConferenceSettings(conferenceId)
  trackId = await createTrack(conferenceId, 'Water')
})

afterAll(async () => {
  await pool.end()
})

describe('conference materials (convenor)', () => {
  it('uploads a real PDF, refuses a renamed text file, edits, hides and deletes - all audit-logged', async () => {
    const cookie = await convenorCookie()
    const up = await request(app).post(`${base()}/materials`).set('Cookie', cookie).field('title', 'Venue map').attach('file', PDF, 'map.pdf')
    expect(up.status).toBe(201)
    const fake = await request(app).post(`${base()}/materials`).set('Cookie', cookie).field('title', 'Not a pdf').attach('file', Buffer.from('hello'), 'evil.pdf')
    expect(fake.status).toBe(400)
    const noTitle = await request(app).post(`${base()}/materials`).set('Cookie', cookie).attach('file', PDF, 'x.pdf')
    expect(noTitle.status).toBe(400)

    expect((await request(app).patch(`${base()}/materials/${up.body.id}`).set('Cookie', cookie).send({ title: 'Venue map (updated)', is_visible: false })).status).toBe(200)
    const list = await request(app).get(`${base()}/materials`).set('Cookie', cookie)
    expect(list.body.materials).toMatchObject([{ title: 'Venue map (updated)', is_visible: false, mime_type: 'application/pdf' }])
    expect((await request(app).get(`${base()}/materials/${up.body.id}/download`).set('Cookie', cookie)).status).toBe(200)
    expect((await request(app).delete(`${base()}/materials/${up.body.id}`).set('Cookie', cookie)).status).toBe(200)

    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE conference_id = ? AND action LIKE 'material.%' ORDER BY occurred_at`, [conferenceId])
    expect((audit as Array<{ action: string }>).map((a) => a.action)).toEqual(['material.create', 'material.update', 'material.delete'])
  })

  it('a manager can upload; staff and the Audience cannot', async () => {
    expect((await request(app).post(`${base()}/materials`).set('Cookie', await convenorCookie('manager')).field('title', 'Booklet').attach('file', PDF, 'b.pdf')).status).toBe(201)
    expect((await request(app).post(`${base()}/materials`).set('Cookie', await convenorCookie('staff')).field('title', 'Booklet').attach('file', PDF, 'b.pdf')).status).toBe(403)
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await request(app).post(`${base()}/materials`).set('Cookie', cookie).field('title', 'Booklet').attach('file', PDF, 'b.pdf')).status).toBe(403)
    expect((await request(app).get(`${base()}/materials`).set('Cookie', cookie)).status).toBe(403)
  })
})

describe('Audience materials and downloads', () => {
  it('lists visible materials plus consented files of final/scheduled/presented papers only', async () => {
    const cookie = await convenorCookie()
    await request(app).post(`${base()}/materials`).set('Cookie', cookie).field('title', 'Venue map').attach('file', PDF, 'map.pdf')
    const hidden = await request(app).post(`${base()}/materials`).set('Cookie', cookie).field('title', 'Draft notes').attach('file', PDF, 'notes.pdf')
    await request(app).patch(`${base()}/materials/${hidden.body.id}`).set('Cookie', cookie).send({ is_visible: false })

    await paperWithFiles('final_approved', 'Final paper both', { slides: true, paper: true })
    await paperWithFiles('scheduled', 'Scheduled slides only', { slides: true, paper: false })
    await paperWithFiles('presented', 'Presented no consent', { slides: false, paper: false })
    await paperWithFiles('accepted', 'Accepted not yet final', { slides: true, paper: true })

    const { cookie: aud } = await createAudienceMember(conferenceId, 'aud@example.com')
    const res = await request(app).get(`${base()}/audience/materials`).set('Cookie', aud)
    expect(res.status).toBe(200)
    const rows = res.body.materials.map((m: { kind: string; title: string }) => `${m.kind}:${m.title}`).sort()
    expect(rows).toEqual(['material:Venue map', 'paper:Final paper both', 'slides:Final paper both', 'slides:Scheduled slides only'])
    expect(JSON.stringify(res.body)).not.toContain('secret-author@example.com')
    expect(JSON.stringify(res.body)).not.toContain('storage_path')
  })

  it('downloads through the authenticated route only, re-checking consent each time', async () => {
    const { id, authorCookie } = await paperWithFiles('final_approved', 'Consent paper', { slides: true, paper: true })
    const { cookie: aud } = await createAudienceMember(conferenceId, 'aud@example.com')
    const ok = await request(app).get(`${base()}/audience/materials/slides/${id}/download`).set('Cookie', aud)
    expect(ok.status).toBe(200)
    expect(ok.headers['cache-control']).toBe('private, no-store')
    expect((await request(app).get(`${base()}/audience/materials/paper/${id}/download`).set('Cookie', aud)).status).toBe(200)

    // The author withdraws consent for the paper: the next download is refused.
    const consent = await request(app).put(`${base()}/submissions/${id}/audience-consent`).set('Cookie', authorCookie).send({ slides_allowed: true, paper_allowed: false })
    expect(consent.status).toBe(200)
    expect((await request(app).get(`${base()}/audience/materials/paper/${id}/download`).set('Cookie', aud)).status).toBe(404)
    expect((await request(app).get(`${base()}/audience/materials/slides/${id}/download`).set('Cookie', aud)).status).toBe(200)

    // Signed out, unconfirmed, or not Audience: no download.
    expect((await request(app).get(`${base()}/audience/materials/slides/${id}/download`)).status).toBe(401)
    const pending = await createAudienceMember(conferenceId, 'pending@example.com', { registrationStatus: 'pending' })
    expect((await request(app).get(`${base()}/audience/materials/slides/${id}/download`).set('Cookie', pending.cookie)).status).toBe(403)
    const reviewer = await convenorCookie('reviewer')
    expect((await request(app).get(`${base()}/audience/materials/slides/${id}/download`).set('Cookie', reviewer)).status).toBe(403)
  })

  it('a hidden material cannot be downloaded by the Audience', async () => {
    const cookie = await convenorCookie()
    const up = await request(app).post(`${base()}/materials`).set('Cookie', cookie).field('title', 'Hidden').attach('file', PDF, 'h.pdf')
    await request(app).patch(`${base()}/materials/${up.body.id}`).set('Cookie', cookie).send({ is_visible: false })
    const { cookie: aud } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await request(app).get(`${base()}/audience/materials/material/${up.body.id}/download`).set('Cookie', aud)).status).toBe(404)
  })
})

describe('author consent', () => {
  it('only an author of the paper can read or change it, and the change is audit-logged', async () => {
    const { id, authorCookie } = await paperWithFiles('final_approved', 'Consent owner', { slides: false, paper: false })
    expect((await request(app).get(`${base()}/submissions/${id}/audience-consent`).set('Cookie', authorCookie)).body).toEqual({
      slides_allowed: false,
      paper_allowed: false,
    })
    const other = await createUser({ email: 'other-author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, other, 'author')
    const otherCookie = await createDirectSession(other, conferenceId)
    expect((await request(app).put(`${base()}/submissions/${id}/audience-consent`).set('Cookie', otherCookie).send({ slides_allowed: true, paper_allowed: true })).status).toBe(404)

    await request(app).put(`${base()}/submissions/${id}/audience-consent`).set('Cookie', authorCookie).send({ slides_allowed: true, paper_allowed: false })
    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = ? AND action = 'submission.audience_consent'`, [id])
    expect((audit as unknown[]).length).toBe(1)
  })
})

describe('accepted abstracts', () => {
  async function seedAbstracts() {
    const author = await createUser({ email: 'writer@example.com', password: 'Str0ng!Pass' })
    const energy = await createTrack(conferenceId, 'Energy')
    for (const [status, title, track] of [
      ['accepted', 'Glacier melt in the Himalaya', trackId],
      ['scheduled', 'Solar microgrids for villages', energy],
      ['under_review', 'Secret paper under review', trackId],
      ['rejected', 'Rejected paper title', trackId],
      ['submitted', 'Just submitted paper', trackId],
    ] as const) {
      const id = await createSubmission(conferenceId, track, author, { title, status })
      await addSubmissionAuthor(id, { fullName: 'Sita Rai', email: 'sita.private@example.com', isCorresponding: false })
    }
    return { energy }
  }

  it('shows only accepted-or-later papers, never sensitive fields; search and track filter', async () => {
    const { energy } = await seedAbstracts()
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    const res = await request(app).get(`${base()}/audience/abstracts`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.abstracts.map((a: { title: string }) => a.title).sort()).toEqual(['Glacier melt in the Himalaya', 'Solar microgrids for villages'])
    const text = JSON.stringify(res.body)
    for (const banned of ['sita.private@example.com', 'Secret paper', 'Rejected paper', 'status', 'created_by', 'email']) expect(text).not.toContain(banned)
    expect(res.body.abstracts[0].authors[0]).toEqual({ full_name: 'Sita Rai', affiliation: null })

    const byTrack = await request(app).get(`${base()}/audience/abstracts`).query({ track_id: energy }).set('Cookie', cookie)
    expect(byTrack.body.abstracts.map((a: { title: string }) => a.title)).toEqual(['Solar microgrids for villages'])
    const search = await request(app).get(`${base()}/audience/abstracts`).query({ q: 'glacier' }).set('Cookie', cookie)
    expect(search.body.abstracts).toHaveLength(1)
    const byAuthor = await request(app).get(`${base()}/audience/abstracts`).query({ q: 'Sita' }).set('Cookie', cookie)
    expect(byAuthor.body.abstracts).toHaveLength(2)
    const wild = await request(app).get(`${base()}/audience/abstracts`).query({ q: '%' }).set('Cookie', cookie)
    expect(wild.body.abstracts).toHaveLength(0)
  })

  it('follows the two settings: Audience on by default, public page off by default', async () => {
    await seedAbstracts()
    expect((await request(app).get(`${base()}/abstracts/public`)).status).toBe(404)
    await setAudienceSettings(conferenceId, { public_abstracts_enabled: true })
    const pub = await request(app).get(`${base()}/abstracts/public`)
    expect(pub.status).toBe(200)
    expect(pub.body.abstracts).toHaveLength(2)

    await setAudienceSettings(conferenceId, { audience_abstracts_enabled: false })
    const { cookie } = await createAudienceMember(conferenceId, 'aud@example.com')
    expect((await request(app).get(`${base()}/audience/abstracts`).set('Cookie', cookie)).status).toBe(403)
  })

  it('the public list 404s for a draft conference even when switched on', async () => {
    const draft = await createConference({ status: 'draft' })
    await upsertConferenceSettings(draft)
    await setAudienceSettings(draft, { public_abstracts_enabled: true })
    expect((await request(app).get(`/api/conferences/${draft}/abstracts/public`)).status).toBe(404)
  })
})

describe('Audience settings (convenor and manager)', () => {
  it('reads defaults, saves with validation, audit-logs, and refuses other roles', async () => {
    const cookie = await convenorCookie('manager')
    const read = await request(app).get(`${base()}/audience-settings`).set('Cookie', cookie)
    expect(read.body.settings).toEqual({
      qa_minutes_after_end: 30,
      audience_feedback_closes_at: null,
      schedule_change_emails: true,
      audience_abstracts_enabled: true,
      public_abstracts_enabled: false,
    })
    const bad = await request(app).put(`${base()}/audience-settings`).set('Cookie', cookie).send({ ...read.body.settings, qa_minutes_after_end: 5000 })
    expect(bad.status).toBe(400)
    const closes = new Date(Date.now() + 86_400_000).toISOString()
    const saved = await request(app)
      .put(`${base()}/audience-settings`)
      .set('Cookie', cookie)
      .send({ ...read.body.settings, qa_minutes_after_end: 15, audience_feedback_closes_at: closes, public_abstracts_enabled: true })
    expect(saved.status).toBe(200)
    expect(saved.body.settings.qa_minutes_after_end).toBe(15)
    expect(saved.body.settings.audience_feedback_closes_at).toBe(closes)
    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE conference_id = ? AND action = 'settings.audience_update'`, [conferenceId])
    expect((audit as unknown[]).length).toBe(1)

    for (const role of ['staff', 'reviewer']) {
      expect((await request(app).get(`${base()}/audience-settings`).set('Cookie', await convenorCookie(role))).status).toBe(403)
    }
  })
})
