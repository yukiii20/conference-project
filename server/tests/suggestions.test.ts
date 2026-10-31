import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { SUGGESTION_DAILY_RATE_LIMIT_CONFIG, SUGGESTION_IP_RATE_LIMIT_CONFIG } from '../src/middleware/rateLimit.js'
import { createConference, createDirectSession, createUser, makePlatformAdmin, resetDatabase } from './helpers.js'

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
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAsAdmin(email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await makePlatformAdmin(userId)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function countSuggestions(): Promise<number> {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM suggestions')
  return Number((rows as Array<{ count: number }>)[0]!.count)
}

describe('POST /api/suggestions (public)', () => {
  it('creates a suggestion with valid input', async () => {
    const res = await request(app).post('/api/suggestions').send({
      name: 'Jamie Rivera',
      email: 'jamie@example.com',
      category: 'feature',
      message: 'Please add dark mode to the portal pages.',
      page_url: '/',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(await countSuggestions()).toBe(1)

    const [rows] = await pool.query('SELECT * FROM suggestions LIMIT 1')
    const row = (rows as Array<Record<string, unknown>>)[0]!
    expect(row.category).toBe('feature')
    expect(row.status).toBe('new')
    expect(row.user_id).toBeNull()
  })

  it('rejects a message under 10 characters', async () => {
    const res = await request(app).post('/api/suggestions').send({ message: 'too short' })
    expect(res.status).toBe(400)
    expect(await countSuggestions()).toBe(0)
  })

  it('rejects a message over 2000 characters', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ message: 'x'.repeat(2001) })
    expect(res.status).toBe(400)
    expect(await countSuggestions()).toBe(0)
  })

  it('rejects an invalid email', async () => {
    const res = await request(app).post('/api/suggestions').send({
      message: 'This is a perfectly valid suggestion message.',
      email: 'not-an-email',
    })
    expect(res.status).toBe(400)
    expect(await countSuggestions()).toBe(0)
  })

  it('strips HTML out of the stored message and name', async () => {
    const res = await request(app).post('/api/suggestions').send({
      name: '<b>Evil</b> Name',
      message: 'Click <script>alert(1)</script> here to break things please.',
    })
    expect(res.status).toBe(200)

    const [rows] = await pool.query('SELECT name, message FROM suggestions LIMIT 1')
    const row = (rows as Array<{ name: string; message: string }>)[0]!
    expect(row.name).toBe('Evil Name')
    expect(row.message).not.toContain('<script>')
    expect(row.message).not.toContain('<b>')
  })

  it('honeypot: a filled "website" field is accepted but silently discarded', async () => {
    const res = await request(app).post('/api/suggestions').send({
      message: 'This looks like a perfectly normal suggestion message.',
      website: 'http://spam.example.com',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(await countSuggestions()).toBe(0)
  })

  it('attaches user_id when the submitter is logged in', async () => {
    const userId = await createUser({ email: 'suggest-user@example.com', password: 'Str0ng!Pass' })
    const cookie = await createDirectSession(userId, await createConference())

    const res = await request(app)
      .post('/api/suggestions')
      .set('Cookie', cookie)
      .send({ message: 'A suggestion sent while logged in to my account.' })
    expect(res.status).toBe(200)

    const [rows] = await pool.query('SELECT user_id FROM suggestions LIMIT 1')
    expect((rows as Array<{ user_id: string }>)[0]!.user_id).toBe(userId)
  })
})

describe('suggestion box rate limits (policy, not behavior — real limiting is skipped under NODE_ENV=test, same as every other limiter in this app)', () => {
  it('limits the public endpoint to 3 per 10 minutes per IP', () => {
    expect(SUGGESTION_IP_RATE_LIMIT_CONFIG).toEqual({ windowMs: 10 * 60 * 1000, limit: 3 })
  })

  it('limits the public endpoint to 20 per day per IP', () => {
    expect(SUGGESTION_DAILY_RATE_LIMIT_CONFIG).toEqual({ windowMs: 24 * 60 * 60 * 1000, limit: 20 })
  })
})

describe('admin suggestions endpoints', () => {
  it('requires admin: 401 with no session, 403 for a non-admin', async () => {
    const anon = await request(app).get('/api/admin/suggestions')
    expect(anon.status).toBe(401)

    const userId = await createUser({ email: 'not-admin-sugg@example.com', password: 'Str0ng!Pass' })
    const cookie = await createDirectSession(userId, await createConference())
    const res = await cookieAgent(cookie).get('/api/admin/suggestions')
    expect(res.status).toBe(403)
  })

  it('lists, filters by status/category, searches, and paginates', async () => {
    await request(app).post('/api/suggestions').send({ category: 'bug', message: 'Something is broken on the page.' })
    await request(app).post('/api/suggestions').send({ category: 'feature', message: 'Please add this nice feature.' })
    await request(app)
      .post('/api/suggestions')
      .send({ category: 'feature', message: 'A searchable needle message here.' })

    const { agent } = await loginAsAdmin('list-admin@example.com')

    const all = await agent.get('/api/admin/suggestions')
    expect(all.status).toBe(200)
    expect(all.body.total).toBe(3)
    expect(all.body.counts_by_status).toEqual(expect.arrayContaining([{ status: 'new', count: 3 }]))

    const byCategory = await agent.get('/api/admin/suggestions?category=bug')
    expect(byCategory.body.total).toBe(1)

    const bySearch = await agent.get('/api/admin/suggestions?q=needle')
    expect(bySearch.body.total).toBe(1)
    expect(bySearch.body.suggestions[0].message).toContain('needle')

    const paged = await agent.get('/api/admin/suggestions?page=1')
    expect(paged.body.page).toBe(1)
    expect(paged.body.suggestions.length).toBe(3)
  })

  it('opening a NEW suggestion marks it read automatically', async () => {
    await request(app).post('/api/suggestions').send({ message: 'Please look at this when you can.' })
    const { agent } = await loginAsAdmin('read-admin@example.com')

    const [rows] = await pool.query('SELECT id FROM suggestions LIMIT 1')
    const id = (rows as Array<{ id: string }>)[0]!.id

    const res = await agent.get(`/api/admin/suggestions/${id}`)
    expect(res.status).toBe(200)
    expect(res.body.suggestion.status).toBe('read')

    const [after] = await pool.query('SELECT status FROM suggestions WHERE id = ?', [id])
    expect((after as Array<{ status: string }>)[0]!.status).toBe('read')
  })

  it('updates status and admin_note, sets handled_by, and writes an audit log entry', async () => {
    await request(app).post('/api/suggestions').send({ message: 'This needs a convenor decision please.' })
    const { agent, userId } = await loginAsAdmin('update-admin@example.com')

    const [rows] = await pool.query('SELECT id FROM suggestions LIMIT 1')
    const id = (rows as Array<{ id: string }>)[0]!.id

    const res = await agent.patch(`/api/admin/suggestions/${id}`).send({ status: 'resolved', admin_note: 'Done, shipped it.' })
    expect(res.status).toBe(200)
    expect(res.body.suggestion.status).toBe('resolved')
    expect(res.body.suggestion.admin_note).toBe('Done, shipped it.')

    const [dbRows] = await pool.query('SELECT status, admin_note, handled_by FROM suggestions WHERE id = ?', [id])
    const row = (dbRows as Array<{ status: string; admin_note: string; handled_by: string }>)[0]!
    expect(row.status).toBe('resolved')
    expect(row.handled_by).toBe(userId)

    const [auditRows] = await pool.query(
      `SELECT action FROM audit_logs WHERE entity_type = 'suggestions' AND entity_id = ? ORDER BY id DESC`,
      [id],
    )
    expect((auditRows as Array<{ action: string }>).map((r) => r.action)).toContain('suggestion.update')
  })

  it('deletes a suggestion and writes an audit log entry', async () => {
    await request(app).post('/api/suggestions').send({ message: 'This suggestion will be deleted soon.' })
    const { agent } = await loginAsAdmin('delete-admin@example.com')

    const [rows] = await pool.query('SELECT id FROM suggestions LIMIT 1')
    const id = (rows as Array<{ id: string }>)[0]!.id

    const res = await agent.delete(`/api/admin/suggestions/${id}`)
    expect(res.status).toBe(200)
    expect(await countSuggestions()).toBe(0)

    const [auditRows] = await pool.query(
      `SELECT action FROM audit_logs WHERE entity_type = 'suggestions' AND entity_id = ? AND action = 'suggestion.delete'`,
      [id],
    )
    expect((auditRows as unknown[]).length).toBe(1)
  })

  it('exports a CSV of the current filter', async () => {
    await request(app).post('/api/suggestions').send({ category: 'bug', message: 'Exported row message content.' })
    const { agent } = await loginAsAdmin('export-admin@example.com')

    const res = await agent.get('/api/admin/suggestions/export.csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.text).toContain('Exported row message content.')
  })
})

describe('new-suggestion admin email digest', () => {
  it('queues one notification email per active admin, throttled to one per 15 minutes (no real emails sent)', async () => {
    const { userId: adminId } = await loginAsAdmin('notify-admin@example.com')

    const first = await request(app).post('/api/suggestions').send({ category: 'bug', message: 'First suggestion message here.' })
    expect(first.status).toBe(200)

    const [firstEmails] = await pool.query(
      `SELECT subject, status FROM email_logs WHERE template_key = 'new_suggestion' AND user_id = ?`,
      [adminId],
    )
    expect((firstEmails as Array<{ subject: string; status: string }>)).toHaveLength(1)
    expect((firstEmails as Array<{ subject: string }>)[0]!.subject).toBe('New suggestion: bug')
    expect((firstEmails as Array<{ status: string }>)[0]!.status).toBe('queued')

    // A second suggestion arriving right after must not queue a second email
    // (throttled to at most one every 15 minutes) — it's absorbed into the
    // next digest instead.
    const second = await request(app).post('/api/suggestions').send({ category: 'feature', message: 'Second suggestion message here.' })
    expect(second.status).toBe(200)

    const [allEmails] = await pool.query(
      `SELECT subject FROM email_logs WHERE template_key = 'new_suggestion' AND user_id = ?`,
      [adminId],
    )
    expect((allEmails as unknown[])).toHaveLength(1)
  })

  it('does not queue any email when the platform setting is off', async () => {
    const { agent, userId: adminId } = await loginAsAdmin('notify-off-admin@example.com')
    const current = await agent.get('/api/admin/platform-settings')
    await agent.patch('/api/admin/platform-settings').send({ ...current.body.settings, notify_admins_of_suggestions: false })

    await request(app).post('/api/suggestions').send({ message: 'Nobody should be emailed about this one.' })

    const [rows] = await pool.query(
      `SELECT 1 FROM email_logs WHERE template_key = 'new_suggestion' AND user_id = ?`,
      [adminId],
    )
    expect((rows as unknown[])).toHaveLength(0)
  })
})
