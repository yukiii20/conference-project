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
  const cookie = await createDirectSession(userId, conferenceId || undefined)
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

  it('lets staff and session chairs search registrations, but not a plain author', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const { registrationId } = await registerAndConfirm(conferenceId, 'search-attendee@example.com')

    const { agent: staffAgent } = await loginAs(conferenceId, 'search-staff@example.com', 'staff')
    const staffRes = await staffAgent.get(`/api/conferences/${conferenceId}/registrations/search?q=search-attendee`)
    expect(staffRes.status).toBe(200)
    expect(staffRes.body.registrations.some((r: { id: string }) => r.id === registrationId)).toBe(true)

    const { agent: authorAgent } = await loginAs(conferenceId, 'search-author@example.com', 'author')
    const authorRes = await authorAgent.get(`/api/conferences/${conferenceId}/registrations/search?q=search-attendee`)
    expect(authorRes.status).toBe(403)

    // A session chair with no attendance.record permission can still search,
    // since they need to find people to check into their own session.
    await pool.query(`INSERT INTO rooms (conference_id, name, equipment) VALUES (?, 'Hall A', JSON_ARRAY())`, [conferenceId])
    const [roomRows] = await pool.query('SELECT id FROM rooms WHERE conference_id = ? LIMIT 1', [conferenceId])
    const roomId = (roomRows as Array<{ id: string }>)[0]!.id
    await pool.query(
      `INSERT INTO conference_sessions (conference_id, room_id, title, session_type, starts_at, ends_at, status)
       VALUES (?, ?, 'Talk', 'paper', DATE_ADD(NOW(3), INTERVAL 1 HOUR), DATE_ADD(NOW(3), INTERVAL 2 HOUR), 'published')`,
      [conferenceId, roomId],
    )
    const [sessionRows] = await pool.query('SELECT id FROM conference_sessions WHERE conference_id = ? LIMIT 1', [conferenceId])
    const sessionId = (sessionRows as Array<{ id: string }>)[0]!.id
    const { agent: chairAgent, userId: chairId } = await loginAs(conferenceId, 'search-chair@example.com', 'session_chair')
    await pool.query(`INSERT INTO session_chairs (session_id, user_id, chair_role) VALUES (?, ?, 'chair')`, [sessionId, chairId])

    const chairRes = await chairAgent.get(`/api/conferences/${conferenceId}/registrations/search?q=search-attendee`)
    expect(chairRes.status).toBe(200)
    expect(chairRes.body.registrations.some((r: { id: string }) => r.id === registrationId)).toBe(true)
  })
})

describe('check-in lookup (preview, never records attendance)', () => {
  it('finds a confirmed registration by ticket code, case-insensitively and with surrounding spaces trimmed', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'lookup-code-author@example.com', 'author')
    const reg = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })

    const { agent: staffAgent } = await loginAs(conferenceId, 'lookup-code-staff@example.com', 'staff')
    const res = await staffAgent.get(
      `/api/conferences/${conferenceId}/registrations/lookup?code=${encodeURIComponent(`  ${(reg.body.registration_number as string).toLowerCase()}  `)}`,
    )
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(reg.body.id)
    expect(res.body.status).toBe('confirmed')
    expect(res.body.already_checked_in_today).toBe(false)
    expect(res.body.checked_in_at).toBeNull()

    // A pure preview — no attendance row was created.
    const dashboard = await staffAgent.get(`/api/conferences/${conferenceId}/attendance/dashboard`)
    expect(dashboard.body.checked_in_today).toBe(0)
  })

  it('looks up a registration by qr_token the same way', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'lookup-qr-author@example.com', 'author')
    const reg = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    const [rows] = await pool.query('SELECT qr_token FROM registrations WHERE id = ?', [reg.body.id])
    const qrToken = (rows as Array<{ qr_token: string }>)[0]!.qr_token

    const { agent: staffAgent } = await loginAs(conferenceId, 'lookup-qr-staff@example.com', 'staff')
    const res = await staffAgent.get(`/api/conferences/${conferenceId}/registrations/lookup?qr_token=${qrToken}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(reg.body.id)
  })

  it('returns not found for a ticket code that belongs to a different conference', async () => {
    const conferenceA = await createConference()
    const conferenceB = await createConference()
    await openRegistration(conferenceA)
    const categoryId = await makeCategory(conferenceA)
    const { agent } = await loginAs(conferenceA, 'lookup-wrong-conf-author@example.com', 'author')
    const reg = await agent.post(`/api/conferences/${conferenceA}/register`).send({ category_id: categoryId })

    await openRegistration(conferenceB)
    const { agent: staffAgentB } = await loginAs(conferenceB, 'lookup-wrong-conf-staff@example.com', 'staff')
    const res = await staffAgentB.get(
      `/api/conferences/${conferenceB}/registrations/lookup?code=${reg.body.registration_number}`,
    )
    expect(res.status).toBe(404)
  })

  it('returns not found for a ticket code that does not exist at all', async () => {
    const conferenceId = await createConference()
    const { agent: staffAgent } = await loginAs(conferenceId, 'lookup-missing-staff@example.com', 'staff')
    const res = await staffAgent.get(`/api/conferences/${conferenceId}/registrations/lookup?code=NOPE-R9999`)
    expect(res.status).toBe(404)
  })

  it('shows a cancelled registration as cancelled, not a generic error', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'lookup-cancelled-author@example.com', 'author')
    const reg = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    await agent.delete(`/api/conferences/${conferenceId}/my-registration`)

    const { agent: staffAgent } = await loginAs(conferenceId, 'lookup-cancelled-staff@example.com', 'staff')
    const res = await staffAgent.get(`/api/conferences/${conferenceId}/registrations/lookup?code=${reg.body.registration_number}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')
  })

  it('shows a pending registration as pending, with can_confirm true for a convenor and false for staff', async () => {
    const conferenceId = await createConference()
    await upsertConferenceSettings(conferenceId, { registration_requires_payment: true })
    await setDeadlineWindow(conferenceId, 'registration', -24, 24)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'lookup-pending-author@example.com', 'author')
    const reg = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(reg.body.status).toBe('pending')

    const { agent: convenorAgent } = await loginAs(conferenceId, 'lookup-pending-convenor@example.com', 'convenor')
    const asConvenor = await convenorAgent.get(
      `/api/conferences/${conferenceId}/registrations/lookup?code=${reg.body.registration_number}`,
    )
    expect(asConvenor.status).toBe(200)
    expect(asConvenor.body.status).toBe('pending')
    expect(asConvenor.body.can_confirm).toBe(true)

    const { agent: staffAgent } = await loginAs(conferenceId, 'lookup-pending-staff@example.com', 'staff')
    const asStaff = await staffAgent.get(`/api/conferences/${conferenceId}/registrations/lookup?code=${reg.body.registration_number}`)
    expect(asStaff.status).toBe(200)
    expect(asStaff.body.can_confirm).toBe(false)
  })

  it('reports already_checked_in_today with a checked_in_at time after a real check-in, without creating a duplicate', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'lookup-dup-author@example.com', 'author')
    const reg = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })

    const { agent: staffAgent } = await loginAs(conferenceId, 'lookup-dup-staff@example.com', 'staff')
    await staffAgent.post(`/api/conferences/${conferenceId}/checkin/manual`).send({ registration_id: reg.body.id })

    const res = await staffAgent.get(`/api/conferences/${conferenceId}/registrations/lookup?code=${reg.body.registration_number}`)
    expect(res.status).toBe(200)
    expect(res.body.already_checked_in_today).toBe(true)
    expect(res.body.checked_in_at).toBeTruthy()

    const dashboard = await staffAgent.get(`/api/conferences/${conferenceId}/attendance/dashboard`)
    expect(dashboard.body.checked_in_today).toBe(1) // the lookup above did not add a second check-in
  })

  it('rejects a lookup from a user without attendance.record permission', async () => {
    const conferenceId = await createConference()
    await openRegistration(conferenceId)
    const categoryId = await makeCategory(conferenceId)
    const { agent } = await loginAs(conferenceId, 'lookup-forbidden-author@example.com', 'author')
    const reg = await agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })

    const res = await agent.get(`/api/conferences/${conferenceId}/registrations/lookup?code=${reg.body.registration_number}`)
    expect(res.status).toBe(403)
  })

  it('rejects a lookup with neither a code nor a qr_token', async () => {
    const conferenceId = await createConference()
    const { agent: staffAgent } = await loginAs(conferenceId, 'lookup-neither-staff@example.com', 'staff')
    const res = await staffAgent.get(`/api/conferences/${conferenceId}/registrations/lookup`)
    expect(res.status).toBe(400)
  })
})
