import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createUser, resetDatabase, setDeadlineWindow, upsertConferenceSettings } from './helpers.js'

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

async function loginAs(conferenceId: string, email: string, role?: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  if (role) await addConferenceMember(conferenceId, userId, role)
  const cookie = await createDirectSession(userId, conferenceId)
  return { agent: cookieAgent(cookie), userId }
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

async function setup(requiresPayment = false) {
  const conferenceId = await createConference()
  await upsertConferenceSettings(conferenceId, { registration_requires_payment: requiresPayment })
  await setDeadlineWindow(conferenceId, 'registration', -24, 24)
  const convenor = await loginAs(conferenceId, 'fees-convenor@example.com', 'convenor')
  const cat = await convenor.agent
    .post(`/api/conferences/${conferenceId}/registration-categories`)
    .send({ code: 'student', name: 'Student', is_active: true, display_order: 0 })
  expect(cat.status).toBe(201)
  return { conferenceId, convenor, categoryId: cat.body.id as string }
}

function fee(amount: number, fromH: number, untilH: number, extra: Record<string, unknown> = {}) {
  return { fee_type: 'regular', amount, currency: 'npr', valid_from: hoursFromNow(fromH), valid_until: hoursFromNow(untilH), ...extra }
}

describe('registration fees', () => {
  it('convenor adds a price; categories show the current price', async () => {
    const { conferenceId, convenor, categoryId } = await setup()
    const res = await convenor.agent.post(`/api/conferences/${conferenceId}/registration-categories/${categoryId}/fees`).send(fee(1500, -1, 48))
    expect(res.status).toBe(201)

    const list = await convenor.agent.get(`/api/conferences/${conferenceId}/registration-categories`)
    const student = list.body.categories.find((c: { id: string }) => c.id === categoryId)
    expect(student.priced).toBe(true)
    expect(student.current_fee).toMatchObject({ amount: 1500, currency: 'NPR', fee_type: 'regular' })

    const fees = await convenor.agent.get(`/api/conferences/${conferenceId}/registration-fees`)
    expect(fees.body.fees).toHaveLength(1)
  })

  it('rejects overlapping active prices (database trigger) with a readable 409', async () => {
    const { conferenceId, convenor, categoryId } = await setup()
    const url = `/api/conferences/${conferenceId}/registration-categories/${categoryId}/fees`
    expect((await convenor.agent.post(url).send(fee(1000, 0, 48))).status).toBe(201)
    const clash = await convenor.agent.post(url).send(fee(1200, 24, 72, { fee_type: 'late' }))
    expect(clash.status).toBe(409)
    expect(clash.body.error?.message).toMatch(/already has an active price/)
  })

  it('rejects an end before the start and a bad currency', async () => {
    const { conferenceId, convenor, categoryId } = await setup()
    const url = `/api/conferences/${conferenceId}/registration-categories/${categoryId}/fees`
    expect((await convenor.agent.post(url).send(fee(1000, 10, 5))).status).toBe(400)
    expect((await convenor.agent.post(url).send(fee(1000, 0, 5, { currency: 'RUPEES' }))).status).toBe(400)
  })

  it('a non-member cannot manage prices', async () => {
    const { conferenceId, categoryId } = await setup()
    const outsider = await loginAs(conferenceId, 'fees-outsider@example.com')
    const res = await outsider.agent.post(`/api/conferences/${conferenceId}/registration-categories/${categoryId}/fees`).send(fee(1000, 0, 5))
    expect(res.status).toBe(403)
  })

  it('deleting a used price only switches it off', async () => {
    const { conferenceId, convenor, categoryId } = await setup()
    const created = await convenor.agent.post(`/api/conferences/${conferenceId}/registration-categories/${categoryId}/fees`).send(fee(500, -1, 48))
    const attendee = await loginAs(conferenceId, 'fees-attendee-del@example.com')
    expect((await attendee.agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })).status).toBe(201)
    const del = await convenor.agent.delete(`/api/conferences/${conferenceId}/registration-fees/${created.body.id}`)
    expect(del.status).toBe(200)
    expect(del.body.deactivated).toBe(true)
  })
})

describe('registering with a price', () => {
  it('a paid category starts pending with the amount due, even when payment is not required by default', async () => {
    const { conferenceId, convenor, categoryId } = await setup(false)
    await convenor.agent.post(`/api/conferences/${conferenceId}/registration-categories/${categoryId}/fees`).send(fee(2000, -1, 48))
    const attendee = await loginAs(conferenceId, 'fees-attendee@example.com')
    const res = await attendee.agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ status: 'pending', amount_due: 2000, currency: 'NPR' })
  })

  it('a free category is confirmed straight away (when payment is not required)', async () => {
    const { conferenceId, categoryId } = await setup(false)
    const attendee = await loginAs(conferenceId, 'fees-free@example.com')
    const res = await attendee.agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(res.body).toMatchObject({ status: 'confirmed', amount_due: 0 })
  })

  it('a priced category with no price covering today cannot be registered for', async () => {
    const { conferenceId, convenor, categoryId } = await setup(false)
    await convenor.agent.post(`/api/conferences/${conferenceId}/registration-categories/${categoryId}/fees`).send(fee(2000, 48, 96))
    const attendee = await loginAs(conferenceId, 'fees-gap@example.com')
    const res = await attendee.agent.post(`/api/conferences/${conferenceId}/register`).send({ category_id: categoryId })
    expect(res.status).toBe(409)
    expect(res.body.error?.message).toMatch(/no price for this category today/)
  })
})

describe('payments', () => {
  async function pendingRegistration(amount = 1000) {
    const ctx = await setup(false)
    await ctx.convenor.agent.post(`/api/conferences/${ctx.conferenceId}/registration-categories/${ctx.categoryId}/fees`).send(fee(amount, -1, 48))
    const attendee = await loginAs(ctx.conferenceId, `payer-${amount}@example.com`)
    const reg = await attendee.agent.post(`/api/conferences/${ctx.conferenceId}/register`).send({ category_id: ctx.categoryId })
    return { ...ctx, attendee, registrationId: reg.body.id as string }
  }

  it('part payment keeps it pending; the payment that covers the rest confirms it', async () => {
    const { conferenceId, convenor, registrationId } = await pendingRegistration(1000)
    const url = `/api/conferences/${conferenceId}/registrations/${registrationId}/payments`
    const first = await convenor.agent.post(url).send({ amount: 400, method: 'cash' })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ amount_paid: 400, confirmed: false })
    const second = await convenor.agent.post(url).send({ amount: 600, method: 'bank_transfer', reference: 'NIC-123' })
    expect(second.body).toMatchObject({ amount_paid: 1000, confirmed: true })

    const list = await convenor.agent.get(url)
    expect(list.body.payments).toHaveLength(2)
    expect(list.body.amount_paid).toBe(1000)

    const regs = await convenor.agent.get(`/api/conferences/${conferenceId}/registrations`)
    expect(regs.body.registrations[0]).toMatchObject({ status: 'confirmed', amount_paid: '1000.00' })

    const [emails] = await pool.query(`SELECT template_key FROM email_logs WHERE template_key = 'payment_received'`)
    expect(emails).toHaveLength(2)
  })

  it('a voided payment stops counting; voiding twice is rejected', async () => {
    const { conferenceId, convenor, registrationId } = await pendingRegistration(1000)
    const url = `/api/conferences/${conferenceId}/registrations/${registrationId}/payments`
    const p = await convenor.agent.post(url).send({ amount: 300, method: 'esewa' })
    const v = await convenor.agent.post(`${url}/${p.body.id}/void`).send({ reason: 'Entered twice' })
    expect(v.status).toBe(200)
    expect((await convenor.agent.get(url)).body.amount_paid).toBe(0)
    expect((await convenor.agent.post(`${url}/${p.body.id}/void`).send({ reason: 'again' })).status).toBe(409)
  })

  it('rejects zero/negative amounts and unknown methods', async () => {
    const { conferenceId, convenor, registrationId } = await pendingRegistration(1000)
    const url = `/api/conferences/${conferenceId}/registrations/${registrationId}/payments`
    expect((await convenor.agent.post(url).send({ amount: 0, method: 'cash' })).status).toBe(400)
    expect((await convenor.agent.post(url).send({ amount: -5, method: 'cash' })).status).toBe(400)
    expect((await convenor.agent.post(url).send({ amount: 5, method: 'bitcoin' })).status).toBe(400)
  })

  it('the attendee cannot record a payment for themselves', async () => {
    const { conferenceId, attendee, registrationId } = await pendingRegistration(1000)
    const res = await attendee.agent.post(`/api/conferences/${conferenceId}/registrations/${registrationId}/payments`).send({ amount: 1000, method: 'cash' })
    expect(res.status).toBe(403)
  })

  it('waiving the fee confirms a pending registration and records who and why', async () => {
    const { conferenceId, convenor, registrationId } = await pendingRegistration(1000)
    const res = await convenor.agent.post(`/api/conferences/${conferenceId}/registrations/${registrationId}/waive`).send({ reason: 'Invited speaker' })
    expect(res.status).toBe(200)
    const [rows] = await pool.query('SELECT status, amount_due, waiver_reason, waived_by FROM registrations WHERE id = ?', [registrationId])
    expect((rows as Array<Record<string, unknown>>)[0]).toMatchObject({ status: 'confirmed', amount_due: '0.00', waiver_reason: 'Invited speaker', waived_by: convenor.userId })
  })

  it('the attendee sees amount due and amount paid on their own registration', async () => {
    const { conferenceId, convenor, attendee, registrationId } = await pendingRegistration(1000)
    await convenor.agent.post(`/api/conferences/${conferenceId}/registrations/${registrationId}/payments`).send({ amount: 250, method: 'khalti' })
    const mine = await attendee.agent.get(`/api/conferences/${conferenceId}/my-registration`)
    expect(mine.body.registration).toMatchObject({ amount_due: '1000.00', amount_paid: '250.00', currency: 'NPR', status: 'pending' })
  })
})
