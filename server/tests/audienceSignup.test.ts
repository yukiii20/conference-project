import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  createConference,
  createDirectSession,
  createUser,
  resetDatabase,
  setDeadlineWindow,
  upsertConferenceSettings,
} from './helpers.js'

/**
 * Audience role, Phase 1: self-service sign-up that creates the account, the active Audience
 * role ('attendee') and the registration in ONE step; the QR ticket; the backfill SQL.
 */
const app = createApp()

let conferenceId = ''
let categoryId = ''

async function createCategory(confId: string, code = 'general', isActive = true): Promise<string> {
  await pool.query(
    `INSERT INTO registration_categories (conference_id, code, name, is_active) VALUES (?, ?, ?, ?)`,
    [confId, code, code === 'general' ? 'General' : code, isActive],
  )
  const [rows] = await pool.query(`SELECT id FROM registration_categories WHERE conference_id = ? AND code = ?`, [confId, code])
  return (rows as Array<{ id: string }>)[0]!.id
}

function signupPayload(overrides: Record<string, unknown> = {}) {
  return {
    full_name: 'Asha Audience',
    email: 'asha@example.com',
    phone: '9812345678',
    password: 'Str0ng!Pass1',
    requested_role: 'attendee',
    conference_id: conferenceId,
    category_id: categoryId,
    ...overrides,
  }
}

async function userIdByEmail(email: string): Promise<string | null> {
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email])
  return (rows as Array<{ id: string }>)[0]?.id ?? null
}

function cookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = (raw ?? []).find((c) => c.startsWith('cms_session='))
  if (!cookie) throw new Error('no session cookie')
  return cookie.split(';')[0]!
}

beforeEach(async () => {
  await resetDatabase()
  conferenceId = await createConference({ name: 'Audience Conference', status: 'registration_open' })
  await upsertConferenceSettings(conferenceId, { registration_requires_payment: false })
  await setDeadlineWindow(conferenceId, 'registration', -24, 24)
  categoryId = await createCategory(conferenceId)
})

afterAll(async () => {
  await pool.end()
})

describe('public registration options for the sign-up form', () => {
  it('lists only active categories and says whether registration is open', async () => {
    await createCategory(conferenceId, 'closed_cat', false)
    const res = await request(app).get(`/api/conferences/${conferenceId}/registration-categories/public`)
    expect(res.status).toBe(200)
    expect(res.body.open).toBe(true)
    expect(res.body.categories.map((c: { name: string }) => c.name)).toEqual(['General'])
    expect(res.body.categories[0]).not.toHaveProperty('code')
  })

  it('reports closed outside the Key dates window, and 404 for a draft conference', async () => {
    await setDeadlineWindow(conferenceId, 'registration', -48, -24)
    const closed = await request(app).get(`/api/conferences/${conferenceId}/registration-categories/public`)
    expect(closed.body.open).toBe(false)

    const draft = await createConference({ status: 'draft' })
    expect((await request(app).get(`/api/conferences/${draft}/registration-categories/public`)).status).toBe(404)
  })
})

describe('sign up as Audience: account + role + registration in one step', () => {
  it('creates everything at once, signs the person in, and queues the ticket email', async () => {
    const res = await request(app).post('/api/auth/register').send(signupPayload())
    expect(res.status).toBe(201)
    expect(res.body.signed_in).toBe(true)
    expect(res.body.registration.registration_number).toMatch(/-R0001$/)
    expect(res.body.registration.status).toBe('confirmed')
    expect(res.body.roles.map((r: { role_code: string }) => r.role_code)).toEqual(['attendee'])

    const userId = (await userIdByEmail('asha@example.com'))!
    const [members] = await pool.query(
      `SELECT role_code, status FROM conference_members WHERE user_id = ? AND conference_id = ?`,
      [userId, conferenceId],
    )
    expect(members).toEqual([{ role_code: 'attendee', status: 'active' }])
    const [requests] = await pool.query('SELECT 1 FROM role_requests WHERE user_id = ?', [userId])
    expect(requests).toEqual([]) // no approval step at all

    const [emails] = await pool.query(
      `SELECT template_key, template_data FROM email_logs WHERE user_id = ? ORDER BY id`,
      [userId],
    )
    const keys = (emails as Array<{ template_key: string }>).map((e) => e.template_key)
    expect(keys).toContain('audience_ticket')
    const ticketEmail = (emails as Array<{ template_key: string; template_data: Record<string, string> }>).find(
      (e) => e.template_key === 'audience_ticket',
    )!
    const data = typeof ticketEmail.template_data === 'string' ? JSON.parse(ticketEmail.template_data) : ticketEmail.template_data
    expect(data.ticket_url).toMatch(/\/c\/.+\/ticket$/)
    expect(JSON.stringify(data)).not.toMatch(/qr_token/)

    const [audit] = await pool.query(
      `SELECT action FROM audit_logs WHERE conference_id = ? AND action = 'member.audience_granted'`,
      [conferenceId],
    )
    expect((audit as unknown[]).length).toBe(1)

    // The session cookie works straight away: the QR ticket is there.
    const ticket = await request(app).get(`/api/conferences/${conferenceId}/my-ticket`).set('Cookie', cookieFrom(res))
    expect(ticket.status).toBe(200)
    expect(ticket.body.qr_data_url).toMatch(/^data:image\/png;base64,/)
  })

  it('requires a registration category', async () => {
    const res = await request(app).post('/api/auth/register').send(signupPayload({ category_id: undefined }))
    expect(res.status).toBe(400)
    expect(res.body.error.fields?.category_id).toBeTruthy()
  })

  it('rolls the whole sign-up back when registration is closed (no account left behind)', async () => {
    await setDeadlineWindow(conferenceId, 'registration', -48, -24)
    const res = await request(app).post('/api/auth/register').send(signupPayload())
    expect(res.status).toBe(409)
    expect(await userIdByEmail('asha@example.com')).toBeNull()
  })

  it('refuses an inactive category and rolls back', async () => {
    const inactive = await createCategory(conferenceId, 'old_cat', false)
    const res = await request(app).post('/api/auth/register').send(signupPayload({ category_id: inactive }))
    expect(res.status).toBe(400)
    expect(await userIdByEmail('asha@example.com')).toBeNull()
  })

  it('refuses a category of another conference', async () => {
    const other = await createConference({ status: 'registration_open' })
    const otherCategory = await createCategory(other)
    const res = await request(app).post('/api/auth/register').send(signupPayload({ category_id: otherCategory }))
    expect(res.status).toBe(400)
  })

  it('other roles still wait for approval (no registration, not signed in)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(signupPayload({ requested_role: 'author', category_id: undefined, email: 'writer@example.com' }))
    expect(res.status).toBe(201)
    expect(res.body.signed_in).toBe(false)
    const [requests] = await pool.query(`SELECT role_code, status FROM role_requests`)
    expect(requests).toEqual([{ role_code: 'author', status: 'pending' }])
  })

  it('an existing account joins as Audience with its password and is registered', async () => {
    await createUser({ email: 'old@example.com', password: 'Str0ng!Pass' })
    const res = await request(app).post('/api/auth/join-conference').send({
      email: 'old@example.com',
      password: 'Str0ng!Pass',
      requested_role: 'attendee',
      conference: conferenceId,
      category_id: categoryId,
    })
    expect(res.status).toBe(201)
    expect(res.body.signed_in).toBe(true)
    const [regs] = await pool.query(`SELECT status FROM registrations WHERE conference_id = ?`, [conferenceId])
    expect(regs).toEqual([{ status: 'confirmed' }])

    const again = await request(app).post('/api/auth/join-conference').send({
      email: 'old@example.com',
      password: 'Str0ng!Pass',
      requested_role: 'attendee',
      conference: conferenceId,
      category_id: categoryId,
    })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('already_registered')
  })

  it('a signed-in person at another conference can register here as Audience', async () => {
    const otherConference = await createConference()
    const userId = await createUser({ email: 'roamer@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(otherConference, userId, 'reviewer')
    const cookie = await createDirectSession(userId, otherConference)
    const res = await request(app)
      .post('/api/auth/request-role')
      .set('Cookie', cookie)
      .send({ requested_role: 'attendee', conference: conferenceId, category_id: categoryId })
    expect(res.status).toBe(201)
    expect(res.body.registration.registration_number).toBeTruthy()
  })

  it('signs in with the Audience role afterwards', async () => {
    await request(app).post('/api/auth/register').send(signupPayload())
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'asha@example.com', password: 'Str0ng!Pass1', role: 'attendee', conference: conferenceId })
    expect(login.status).toBe(200)
    expect(login.body.roles.map((r: { role_code: string }) => r.role_code)).toEqual(['attendee'])
  })
})

describe('registering any other way also gives the Audience role', () => {
  it('POST /register (signed-in author) adds an active Audience membership', async () => {
    const userId = await createUser({ email: 'author@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, userId, 'author')
    const cookie = await createDirectSession(userId, conferenceId)
    const res = await request(app).post(`/api/conferences/${conferenceId}/register`).set('Cookie', cookie).send({ category_id: categoryId })
    expect(res.status).toBe(201)
    const [rows] = await pool.query(
      `SELECT role_code FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active' ORDER BY role_code`,
      [userId, conferenceId],
    )
    expect((rows as Array<{ role_code: string }>).map((r) => r.role_code)).toEqual(['attendee', 'author'])
  })

  it('never reactivates an Audience membership the organisers removed', async () => {
    const userId = await createUser({ email: 'removed@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, userId, 'attendee', 'removed')
    await addConferenceMember(conferenceId, userId, 'author')
    const cookie = await createDirectSession(userId, conferenceId)
    await request(app).post(`/api/conferences/${conferenceId}/register`).set('Cookie', cookie).send({ category_id: categoryId })
    const [rows] = await pool.query(
      `SELECT status FROM conference_members WHERE user_id = ? AND conference_id = ? AND role_code = 'attendee'`,
      [userId, conferenceId],
    )
    expect(rows).toEqual([{ status: 'removed' }])
  })
})

describe('the QR ticket', () => {
  async function registeredAudience(): Promise<{ userId: string; cookie: string }> {
    const res = await request(app).post('/api/auth/register').send(signupPayload())
    return { userId: (await userIdByEmail('asha@example.com'))!, cookie: cookieFrom(res) }
  }

  it('is reachable by id or slug, never exposes the raw QR token, and shows check-in state', async () => {
    const { cookie } = await registeredAudience()
    const [confRows] = await pool.query('SELECT slug FROM conferences WHERE id = ?', [conferenceId])
    const slug = (confRows as Array<{ slug: string }>)[0]!.slug
    const res = await request(app).get(`/api/conferences/${slug}/my-ticket`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.registration.checked_in).toBe(false)
    expect(res.body.holder.full_name).toBe('Asha Audience')
    const [qr] = await pool.query('SELECT qr_token FROM registrations WHERE conference_id = ?', [conferenceId])
    expect(JSON.stringify(res.body)).not.toContain((qr as Array<{ qr_token: string }>)[0]!.qr_token)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('refuses another conference (by slug too) and 404s without a registration', async () => {
    const { cookie } = await registeredAudience()
    const other = await createConference({ slug: 'other-conf-ticket' })
    const wrong = await request(app).get(`/api/conferences/other-conf-ticket/my-ticket`).set('Cookie', cookie)
    expect(wrong.status).toBe(403)
    expect(wrong.body.error.code).toBe('wrong_conference')
    expect((await request(app).get(`/api/conferences/${other}/my-ticket`).set('Cookie', cookie)).status).toBe(403)

    const nobody = await createUser({ email: 'nobody@example.com', password: 'Str0ng!Pass' })
    const nobodyCookie = await createDirectSession(nobody, conferenceId)
    expect((await request(app).get(`/api/conferences/${conferenceId}/my-ticket`).set('Cookie', nobodyCookie)).status).toBe(404)
    expect((await request(app).get(`/api/conferences/${conferenceId}/my-ticket`)).status).toBe(401)
  })

  it('emails the ticket again on request, at most 3 times an hour', async () => {
    const { cookie } = await registeredAudience() // the sign-up already queued one
    const first = await request(app).post(`/api/conferences/${conferenceId}/my-ticket/email`).set('Cookie', cookie)
    expect(first.status).toBe(200)
    expect((await request(app).post(`/api/conferences/${conferenceId}/my-ticket/email`).set('Cookie', cookie)).status).toBe(200)
    const limited = await request(app).post(`/api/conferences/${conferenceId}/my-ticket/email`).set('Cookie', cookie)
    expect(limited.status).toBe(429)
  })
})

describe('People: Audience in the members list and the registrations filter', () => {
  it('filters members by the Audience role and registrations by Audience', async () => {
    await request(app).post('/api/auth/register').send(signupPayload())
    const convenor = await createUser({ email: 'convenor@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenor, 'convenor')
    const cookie = await createDirectSession(convenor, conferenceId)

    const members = await request(app).get(`/api/conferences/${conferenceId}/members`).query({ role: 'attendee' }).set('Cookie', cookie)
    expect(members.status).toBe(200)
    expect(members.body.members.map((m: { email: string }) => m.email)).toEqual(['asha@example.com'])

    const only = await request(app).get(`/api/conferences/${conferenceId}/registrations`).query({ audience: 'only' }).set('Cookie', cookie)
    expect(only.body.registrations).toHaveLength(1)
    expect(Boolean(only.body.registrations[0].is_audience)).toBe(true)
    const without = await request(app).get(`/api/conferences/${conferenceId}/registrations`).query({ audience: 'without' }).set('Cookie', cookie)
    expect(without.body.registrations).toHaveLength(0)
  })

  it("an Audience member's role cannot be swapped for another one", async () => {
    await request(app).post('/api/auth/register').send(signupPayload())
    const convenor = await createUser({ email: 'convenor@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenor, 'convenor')
    const cookie = await createDirectSession(convenor, conferenceId)
    const [rows] = await pool.query(`SELECT id FROM conference_members WHERE role_code = 'attendee'`)
    const membershipId = (rows as Array<{ id: string }>)[0]!.id
    const res = await request(app)
      .patch(`/api/conferences/${conferenceId}/members/${membershipId}/role`)
      .set('Cookie', cookie)
      .send({ role_code: 'staff' })
    expect(res.status).toBe(400)
  })
})

describe('backfill in database/09_audience.sql', () => {
  it('gives every live registration an Audience membership, and is safe to run twice', async () => {
    const sql = readFileSync(path.resolve(__dirname, '../../database/09_audience.sql'), 'utf8')
    const match = /INSERT IGNORE INTO conference_members[\s\S]*?;/.exec(sql)
    expect(match).not.toBeNull()

    const u1 = await createUser({ email: 'reg1@example.com', password: 'Str0ng!Pass' })
    const u2 = await createUser({ email: 'reg2@example.com', password: 'Str0ng!Pass' })
    // Registrations made before the Audience role existed: inserted directly, no membership.
    await pool.query(
      `INSERT INTO registrations (conference_id, user_id, category_id, registration_number, status, amount_due, currency, qr_token)
       VALUES (?, ?, ?, 'X-R1', 'confirmed', 0, 'NPR', REPEAT('a', 48)), (?, ?, ?, 'X-R2', 'cancelled', 0, 'NPR', REPEAT('b', 48))`,
      [conferenceId, u1, categoryId, conferenceId, u2, categoryId],
    )
    await pool.query(match![0])
    await pool.query(match![0])
    const [rows] = await pool.query(`SELECT user_id, status FROM conference_members WHERE role_code = 'attendee'`)
    expect(rows).toEqual([{ user_id: u1, status: 'active' }])
  })
})
