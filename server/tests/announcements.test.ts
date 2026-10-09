import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { publishDueAnnouncements } from '../src/modules/announcements/service.js'
import { addConferenceMember, createConference, createDirectSession, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

function cookieAgent(cookie: string) {
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const cookie = await createDirectSession(userId)
  return cookieAgent(cookie)
}

describe('announcements', () => {
  it('publishing immediately notifies (and, if requested, emails) the chosen audience — one row per user', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'ann-conv@example.com')
    const authorId = await createUser({ email: 'ann-author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, authorId, 'author')
    const reviewerId = await createUser({ email: 'ann-reviewer@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewerId, 'reviewer')

    const res = await agent.post(`/api/conferences/${conferenceId}/announcements`).send({
      title: 'Registration is open',
      body: 'Please register soon.',
      audience: ['authors'],
      status: 'published',
      send_email: true,
    })
    expect(res.status).toBe(201)

    const [notifRows] = await pool.query('SELECT user_id FROM notifications WHERE conference_id = ?', [conferenceId])
    expect((notifRows as Array<{ user_id: string }>).map((r) => r.user_id)).toEqual([authorId])

    const [emailRows] = await pool.query(
      `SELECT recipient_email FROM email_logs WHERE conference_id = ? AND template_key = 'announcement'`,
      [conferenceId],
    )
    expect((emailRows as Array<{ recipient_email: string }>)).toHaveLength(1)
    expect((emailRows as Array<{ recipient_email: string }>)[0]!.recipient_email).toBe('ann-author@example.com')
  })

  it('publishes a due scheduled announcement when the job runs, and not before', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'ann-conv2@example.com')
    const authorId = await createUser({ email: 'ann-author2@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, authorId, 'author')

    const past = new Date(Date.now() - 60_000).toISOString()
    const create = await agent.post(`/api/conferences/${conferenceId}/announcements`).send({
      title: 'Scheduled note',
      body: 'This was scheduled.',
      audience: ['all'],
      status: 'scheduled',
      publish_at: past,
    })
    expect(create.status).toBe(201)
    const announcementId = create.body.id

    const [beforeRows] = await pool.query('SELECT status FROM announcements WHERE id = ?', [announcementId])
    expect((beforeRows as Array<{ status: string }>)[0]!.status).toBe('scheduled')

    const published = await publishDueAnnouncements()
    expect(published).toBeGreaterThanOrEqual(1)

    const [afterRows] = await pool.query('SELECT status FROM announcements WHERE id = ?', [announcementId])
    expect((afterRows as Array<{ status: string }>)[0]!.status).toBe('published')

    const [notifRows] = await pool.query('SELECT 1 FROM notifications WHERE user_id = ? AND entity_id = ?', [
      authorId,
      announcementId,
    ])
    expect((notifRows as unknown[]).length).toBe(1)
  })

  it('cannot be edited or deleted once published', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'ann-conv3@example.com')
    const create = await agent.post(`/api/conferences/${conferenceId}/announcements`).send({
      title: 'Published note',
      body: 'Body text.',
      audience: ['all'],
      status: 'published',
    })
    const announcementId = create.body.id

    const edit = await agent
      .patch(`/api/conferences/${conferenceId}/announcements/${announcementId}`)
      .send({ title: 'Changed' })
    expect(edit.status).toBe(400)

    const del = await agent.delete(`/api/conferences/${conferenceId}/announcements/${announcementId}`)
    expect(del.status).toBe(400)
  })

  it('is forbidden for a reviewer', async () => {
    const conferenceId = await createConference()
    const reviewerId = await createUser({ email: 'ann-reviewer-perm@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewerId, 'reviewer')
    const cookie = await createDirectSession(reviewerId)
    const agent = cookieAgent(cookie)

    const res = await agent.get(`/api/conferences/${conferenceId}/announcements`)
    expect(res.status).toBe(403)
  })
})
