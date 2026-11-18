import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createUser, exeBuffer, oversizedBuffer, pdfBuffer, pngBuffer, resetDatabase } from './helpers.js'

/** changes-nov2, Part 6: tickets with a payment receipt. */
const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

type Agent = { userId: string; cookie: string }

async function agent(conferenceId: string, email: string, role: string): Promise<Agent> {
  const userId = await createUser({ email, password: 'Str0ng!Pass', fullName: email.split('@')[0] })
  await addConferenceMember(conferenceId, userId, role)
  return { userId, cookie: await createDirectSession(userId, conferenceId) }
}

const get = (a: Agent, url: string) => request(app).get(url).set('Cookie', a.cookie)
const post = (a: Agent, url: string) => request(app).post(url).set('Cookie', a.cookie)
const patch = (a: Agent, url: string) => request(app).patch(url).set('Cookie', a.cookie)

async function pendingRegistration(conferenceId: string, userId: string): Promise<string> {
  await pool.query(
    `INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General') ON DUPLICATE KEY UPDATE code = code`,
    [conferenceId],
  )
  const [cat] = await pool.query('SELECT id FROM registration_categories WHERE conference_id = ? LIMIT 1', [conferenceId])
  const number = `REG-${Math.floor(Math.random() * 1_000_000)}`
  await pool.query(
    `INSERT INTO registrations (conference_id, user_id, category_id, registration_number, status, amount_due, currency, qr_token)
     VALUES (?, ?, ?, ?, 'pending', 1500, 'NPR', ?)`,
    [conferenceId, userId, (cat as Array<{ id: string }>)[0]!.id, number, Math.random().toString(36).slice(2).padEnd(48, '0').slice(0, 48)],
  )
  const [rows] = await pool.query('SELECT id FROM registrations WHERE registration_number = ?', [number])
  return (rows as Array<{ id: string }>)[0]!.id
}

async function setup() {
  const conferenceId = await createConference()
  const convenor = await agent(conferenceId, 'rc-convenor@example.com', 'convenor')
  const participant = await agent(conferenceId, 'rc-participant@example.com', 'attendee')
  const other = await agent(conferenceId, 'rc-other@example.com', 'attendee')
  const registrationId = await pendingRegistration(conferenceId, participant.userId)
  return { conferenceId, convenor, participant, other, registrationId }
}

async function uploadReceipt(s: Awaited<ReturnType<typeof setup>>, file?: Buffer, name = 'receipt.png') {
  return post(s.participant, `/api/conferences/${s.conferenceId}/my-registration/receipt`)
    .field('amount', '1500')
    .field('paid_on', '2026-11-10')
    .field('reference', 'TXN-12345')
    .attach('file', file ?? (await pngBuffer()), name)
}

async function emails(registrationId: string, key: string) {
  const [rows] = await pool.query(`SELECT template_data FROM email_logs WHERE entity_id = ? AND template_key = ?`, [registrationId, key])
  return (rows as Array<{ template_data: unknown }>).map((r) => (typeof r.template_data === 'string' ? JSON.parse(r.template_data) : r.template_data))
}

describe('receipt upload', () => {
  it('validates the file by content, size and the payment details', async () => {
    const s = await setup()
    expect((await uploadReceipt(s, exeBuffer(), 'receipt.png')).status).toBe(400) // wrong content, misleading name
    expect((await uploadReceipt(s, oversizedBuffer(5 * 1024 * 1024 + 1), 'big.pdf')).status).toBe(400)
    const noRef = await post(s.participant, `/api/conferences/${s.conferenceId}/my-registration/receipt`)
      .field('amount', '1500')
      .field('paid_on', '2026-11-10')
      .attach('file', await pngBuffer(), 'r.png')
    expect(noRef.status).toBe(400)
    expect(noRef.body.error.fields.reference).toBeTruthy()
  })

  it('stores the receipt as Pending confirmation; it is private to the registrant and organisers', async () => {
    const s = await setup()
    const res = await uploadReceipt(s, pdfBuffer(), 'my receipt.pdf')
    expect(res.status).toBe(201)

    const mine = await get(s.participant, `/api/conferences/${s.conferenceId}/my-registration`)
    expect(mine.body.registration).toMatchObject({ status: 'pending', receipt_reference: 'TXN-12345', receipt_paid_on: '2026-11-10' })
    expect(Boolean(mine.body.registration.has_receipt)).toBe(true)
    expect(JSON.stringify(mine.body)).not.toContain('receipt_path')

    expect((await get(s.participant, `/api/conferences/${s.conferenceId}/my-registration/receipt`)).status).toBe(200)
    expect((await get(s.convenor, `/api/conferences/${s.conferenceId}/registrations/${s.registrationId}/receipt`)).status).toBe(200)
    expect((await get(s.other, `/api/conferences/${s.conferenceId}/registrations/${s.registrationId}/receipt`)).status).toBe(403)
    const staff = await agent(s.conferenceId, 'rc-staff@example.com', 'staff')
    expect((await get(staff, `/api/conferences/${s.conferenceId}/registrations/${s.registrationId}/receipt`)).status).toBe(403)
    expect((await request(app).get(`/api/conferences/${s.conferenceId}/registrations/${s.registrationId}/receipt`)).status).toBe(401)

    const list = await get(s.convenor, `/api/conferences/${s.conferenceId}/registrations?payment=pending_confirmation`)
    expect(list.body.registrations.map((r: { id: string }) => r.id)).toEqual([s.registrationId])
    expect((await get(s.convenor, `/api/conferences/${s.conferenceId}/registrations?payment=awaiting_receipt`)).body.registrations).toHaveLength(0)

    const [audit] = await pool.query(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'registration.receipt_upload' AND entity_id = ?`, [s.registrationId])
    expect(Number((audit as Array<{ n: number }>)[0]!.n)).toBe(1)
  })
})

describe('QR before and after confirmation', () => {
  it('no QR until confirmed; Confirm emails the ticket with a signed QR image', async () => {
    const s = await setup()
    expect((await get(s.participant, `/api/conferences/${s.conferenceId}/my-registration/qr.png`)).status).toBe(404)
    const ticket = await get(s.participant, `/api/conferences/${s.conferenceId}/my-ticket`)
    expect(ticket.status).toBe(200)
    expect(ticket.body.registration.status).toBe('pending')
    expect(ticket.body.qr_data_url).toBeNull()

    await uploadReceipt(s)
    expect((await patch(s.convenor, `/api/conferences/${s.conferenceId}/registrations/${s.registrationId}/confirm`)).status).toBe(200)

    const [sent] = await emails(s.registrationId, 'registration_confirmed')
    expect(sent.ticket_url).toMatch(/\/c\/.+\/ticket$/)
    const qrUrl = new URL(sent.qr_image_url as string)
    const qr = await request(app).get(qrUrl.pathname + qrUrl.search)
    expect(qr.status).toBe(200)
    expect(qr.headers['content-type']).toBe('image/png')
    expect((await request(app).get(qrUrl.pathname + qrUrl.search.replace(/sig=[^&]+/, 'sig=forged'))).status).toBe(404)

    expect((await get(s.participant, `/api/conferences/${s.conferenceId}/my-registration/qr.png`)).status).toBe(200)
    const [notes] = await pool.query(`SELECT title FROM notifications WHERE user_id = ?`, [s.participant.userId])
    expect((notes as Array<{ title: string }>).map((n) => n.title)).toContain('Your registration is confirmed')
  })
})

describe('reject and re-upload', () => {
  it('reject needs a receipt, emails the reason, and a re-upload returns it to pending confirmation', async () => {
    const s = await setup()
    const url = `/api/conferences/${s.conferenceId}/registrations/${s.registrationId}/reject`
    expect((await post(s.convenor, url).send({ reason: 'Amount does not match' })).status).toBe(409) // no receipt yet

    await uploadReceipt(s)
    expect((await post(s.convenor, url).send({ reason: 'x' })).status).toBe(400) // too short
    expect((await post(s.other, url).send({ reason: 'Amount does not match' })).status).toBe(403)
    expect((await post(s.convenor, url).send({ reason: 'Amount does not match' })).status).toBe(200)

    const [rejected] = await emails(s.registrationId, 'registration_rejected')
    expect(rejected.reason).toBe('Amount does not match')
    const mine = await get(s.participant, `/api/conferences/${s.conferenceId}/my-registration`)
    expect(mine.body.registration).toMatchObject({ status: 'pending', rejection_reason: 'Amount does not match' })
    expect((await get(s.convenor, `/api/conferences/${s.conferenceId}/registrations?payment=rejected`)).body.registrations).toHaveLength(1)

    expect((await uploadReceipt(s)).status).toBe(201)
    const again = await get(s.participant, `/api/conferences/${s.conferenceId}/my-registration`)
    expect(again.body.registration.rejection_reason).toBeNull()
    const [audit] = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY id`, [s.registrationId])
    expect((audit as Array<{ action: string }>).map((a) => a.action)).toEqual([
      'registration.receipt_upload',
      'registration.reject',
      'registration.receipt_reupload',
    ])
  })
})

describe('bulk confirm', () => {
  it('confirms each pending registration and reports the ones it could not', async () => {
    const s = await setup()
    const second = await agent(s.conferenceId, 'rc-second@example.com', 'attendee')
    const secondReg = await pendingRegistration(s.conferenceId, second.userId)
    const res = await post(s.convenor, `/api/conferences/${s.conferenceId}/registrations/bulk-confirm`).send({
      registration_ids: [s.registrationId, secondReg],
    })
    expect(res.body).toMatchObject({ confirmed: 2, failed: [] })
    const again = await post(s.convenor, `/api/conferences/${s.conferenceId}/registrations/bulk-confirm`).send({ registration_ids: [s.registrationId] })
    expect(again.body.confirmed).toBe(0)
    expect(again.body.failed).toHaveLength(1)
    expect(await emails(secondReg, 'registration_confirmed')).toHaveLength(1)
  })
})

describe('payment instructions and QR', () => {
  it('saved by the convenor, shown publicly; the QR image is sniffed', async () => {
    const s = await setup()
    const convenorPut = request(app).put(`/api/conferences/${s.conferenceId}/payment-settings`).set('Cookie', s.convenor.cookie)
    expect((await convenorPut.send({ payment_instructions: 'Pay to account 123 <b>Nabil Bank</b>' })).status).toBe(200)
    expect((await post(s.convenor, `/api/conferences/${s.conferenceId}/payment-settings/qr`).attach('file', pdfBuffer(), 'qr.png')).status).toBe(400)
    expect((await post(s.convenor, `/api/conferences/${s.conferenceId}/payment-settings/qr`).attach('file', await pngBuffer(), 'qr.png')).status).toBe(201)

    const info = await request(app).get(`/api/conferences/${s.conferenceId}/payment-info/public`)
    expect(info.body).toEqual({ payment_instructions: 'Pay to account 123 Nabil Bank', has_qr: true })
    const qr = await request(app).get(`/api/conferences/${s.conferenceId}/payment-info/qr`)
    expect(qr.status).toBe(200)
    expect(qr.headers['content-type']).toBe('image/png')

    const asParticipant = request(app).put(`/api/conferences/${s.conferenceId}/payment-settings`).set('Cookie', s.participant.cookie)
    expect((await asParticipant.send({ payment_instructions: 'x' })).status).toBe(403)
  })
})
