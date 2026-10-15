import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  createConference,
  createUser,
  createDirectSession,
  resetDatabase,
  setDeadlineWindow,
  upsertConferenceSettings,
} from './helpers.js'

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

async function loginAs(conferenceId: string, email: string, role: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  if (conferenceId) await addConferenceMember(conferenceId, userId, role)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function openRegistration(conferenceId: string, overrides: Record<string, unknown> = {}) {
  await upsertConferenceSettings(conferenceId, { registration_requires_payment: false, ...overrides })
  await setDeadlineWindow(conferenceId, 'registration', -24, 24)
}

async function makeCategory(conferenceId: string, code = 'general') {
  await pool.query(
    `INSERT INTO registration_categories (conference_id, code, name) VALUES (?, ?, ?)`,
    [conferenceId, code, code],
  )
  const [rows] = await pool.query('SELECT id FROM registration_categories WHERE conference_id = ? AND code = ?', [
    conferenceId,
    code,
  ])
  return (rows as Array<{ id: string }>)[0]!.id
}

describe('registration categories', () => {
  it('auto-creates a "general" category the first time anyone lists them', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'cat-convenor@example.com', 'convenor')
    const res = await agent.get(`/api/conferences/${conferenceId}/registration-categories`)
    expect(res.status).toBe(200)
    expect(res.body.categories).toHaveLength(1)
    expect(res.body.categories[0].code).toBe('general')
  })

  it('convenor creates and edits a category', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'cat-convenor2@example.com', 'convenor')
    const create = await agent
      .post(`/api/conferences/${conferenceId}/registration-categories`)
      .send({ code: 'student', name: 'Student', is_active: true, display_order: 1 })
    expect(create.status).toBe(201)

    const update = await agent
      .patch(`/api/conferences/${conferenceId}/registration-categories/${create.body.id}`)
      .send({ code: 'student', name: 'Student (discounted)', is_active: true, display_order: 1 })
    expect(update.status).toBe(200)
  })
})

describe('registering to attend', () => {
  it('rejects registering outside the registration window', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId)
    await setDeadlineWindow(conferenceId, 'registration', 24, 48) // opens in the future
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'closed-author@example.com', 'author')

    const res = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/not open/i)
  })

  it('registers inside the window with status confirmed when no payment is required', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'open-author@example.com', 'author')

    const res = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('confirmed')
    expect(res.body.registration_number).toMatch(/-R0001$/)
  })

  it('registers with status pending when payment is required, and the convenor can confirm it', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId, { registration_requires_payment: true })
    await setDeadlineWindow(conferenceId, 'registration', -24, 24)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'pending-author@example.com', 'author')

    const res = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending')

    const { agent: convenorAgent } = await loginAs(conferenceId, 'pending-convenor@example.com', 'convenor')
    const confirm = await convenorAgent.patch(`/api/conferences/${conferenceId}/registrations/${res.body.id}/confirm`)
    expect(confirm.status).toBe(200)

    const mine = await agent.get(`/api/conferences/${conferenceId}/my-registration`)
    expect(mine.body.registration.status).toBe('confirmed')
  })

  it('only allows one active registration per user per conference', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'twice-author@example.com', 'author')

    const first = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(first.status).toBe(201)
    const second = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(second.status).toBe(409)
  })

  it('lets a user cancel and then register again', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'cancel-author@example.com', 'author')

    await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    const cancel = await agent.delete(`/api/conferences/${conferenceId}/my-registration`)
    expect(cancel.status).toBe(200)

    const again = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(again.status).toBe(201)
  })

  it('never returns the qr_token in the my-registration or admin list responses', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'qr-author@example.com', 'author')
    await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })

    const mine = await agent.get(`/api/conferences/${conferenceId}/my-registration`)
    expect(JSON.stringify(mine.body)).not.toMatch(/qr_token/)

    const { agent: convenorAgent } = await loginAs(conferenceId, 'qr-convenor@example.com', 'convenor')
    const list = await convenorAgent.get(`/api/conferences/${conferenceId}/registrations`)
    expect(JSON.stringify(list.body)).not.toMatch(/qr_token/)
  })
})

describe('attendance check-in', () => {
  async function registerAndConfirm(conferenceId: string, email: string) {
    const categoryId = await makeCategory(conferenceId)
    const { agent, userId } = await loginAs(conferenceId, email, 'author')
    const res = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    return { registrationId: res.body.id as string, userId }
  }

  it('staff can check someone in by manual search; an author cannot', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const { registrationId } = await registerAndConfirm(conferenceId, 'checkin-attendee@example.com')
    const { agent: staffAgent } = await loginAs(conferenceId, 'checkin-staff@example.com', 'staff')

    const res = await staffAgent.post(`/api/conferences/${conferenceId}/checkin/manual`).send({ registration_id: registrationId })
    expect(res.status).toBe(200)
    expect(res.body.full_name).toBeTruthy()

    const { agent: authorAgent } = await loginAs(conferenceId, 'checkin-blocked-author@example.com', 'author')
    const forbidden = await authorAgent
      .post(`/api/conferences/${conferenceId}/checkin/manual`)
      .send({ registration_id: registrationId })
    expect(forbidden.status).toBe(403)
  })

  it('rejects a second check-in on the same day', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const { registrationId } = await registerAndConfirm(conferenceId, 'twice-checkin@example.com')
    const { agent: staffAgent } = await loginAs(conferenceId, 'twice-checkin-staff@example.com', 'staff')

    const first = await staffAgent.post(`/api/conferences/${conferenceId}/checkin/manual`).send({ registration_id: registrationId })
    expect(first.status).toBe(200)
    const second = await staffAgent.post(`/api/conferences/${conferenceId}/checkin/manual`).send({ registration_id: registrationId })
    expect(second.status).toBe(409)
  })

  it('rejects checking in a cancelled registration', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'cancelled-checkin@example.com', 'author')
    const reg = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    await agent.delete(`/api/conferences/${conferenceId}/my-registration`)

    const { agent: staffAgent } = await loginAs(conferenceId, 'cancelled-checkin-staff@example.com', 'staff')
    const res = await staffAgent.post(`/api/conferences/${conferenceId}/checkin/manual`).send({ registration_id: reg.body.id })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/cancelled/i)
  })

  it('rejects a QR token checked in at the wrong conference', async () => {
    const conferenceA = await createConference()
    const conferenceB = await createConference()
    await openRegistration(conferenceA)
    await openRegistration(conferenceB)
    const categoryId = await makeCategory(conferenceA)
    const { agent } = await loginAs(conferenceA, 'wrong-conf-author@example.com', 'author')
    await agent.post(`/api/conferences/${conferenceA}/register`).send({ category_id: categoryId })

    const [rows] = await pool.query('SELECT qr_token FROM registrations WHERE conference_id = ? LIMIT 1', [conferenceA])
    const qrToken = (rows as Array<{ qr_token: string }>)[0]!.qr_token

    const { agent: staffAgentB } = await loginAs(conferenceB, 'wrong-conf-staff@example.com', 'staff')
    const res = await staffAgentB.post(`/api/conferences/${conferenceB}/checkin`).send({ qr_token: qrToken })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/different conference/i)
  })

  it('rejects an unknown QR token', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const { agent: staffAgent } = await loginAs(conferenceId, 'unknown-qr-staff@example.com', 'staff')
    const res = await staffAgent.post(`/api/conferences/${conferenceId}/checkin`).send({ qr_token: 'does-not-exist-token-1234567890' })
    expect(res.status).toBe(404)
  })

  it('reports registered and checked-in-today counts on the dashboard', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const { registrationId } = await registerAndConfirm(conferenceId, 'dashboard-attendee@example.com')
    const { agent: staffAgent } = await loginAs(conferenceId, 'dashboard-staff@example.com', 'staff')
    await staffAgent.post(`/api/conferences/${conferenceId}/checkin/manual`).send({ registration_id: registrationId })

    const dashboard = await staffAgent.get(`/api/conferences/${conferenceId}/attendance/dashboard`)
    expect(dashboard.status).toBe(200)
    expect(dashboard.body.registered).toBe(1)
    expect(dashboard.body.checked_in_today).toBe(1)
  })
})
