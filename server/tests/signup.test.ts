import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { createConference, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

function validPayload(conferenceId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    full_name: 'Valid Name',
    email: 'valid@example.com',
    phone: '9812345678',
    password: 'Str0ng!Pass1',
    requested_role: 'author',
    conference_id: conferenceId,
    ...overrides,
  }
}

describe('POST /api/auth/register validation', () => {
  it('accepts a fully valid payload', async () => {
    const conferenceId = await createConference()
    const res = await request(app).post('/api/auth/register').send(validPayload(conferenceId))
    expect(res.status).toBe(201)
  })

  it('rejects a malformed email', async () => {
    const conferenceId = await createConference()
    const res = await request(app)
      .post('/api/auth/register')
      .send(validPayload(conferenceId, { email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(res.body.error.fields?.email).toBeTruthy()
  })

  it('rejects a phone number that is not a Nepal mobile number', async () => {
    const conferenceId = await createConference()
    const res = await request(app)
      .post('/api/auth/register')
      .send(validPayload(conferenceId, { phone: '123' }))
    expect(res.status).toBe(400)
    expect(res.body.error.fields?.phone).toBeTruthy()
  })

  it('accepts a Nepal phone number already in E.164 form', async () => {
    const conferenceId = await createConference()
    const res = await request(app)
      .post('/api/auth/register')
      .send(validPayload(conferenceId, { email: 'e164@example.com', phone: '+9779812345678' }))
    expect(res.status).toBe(201)
  })

  it.each([
    ['too short', 'Sh0rt!'],
    ['no uppercase', 'alllower1!'],
    ['no lowercase', 'ALLUPPER1!'],
    ['no number', 'NoNumbers!'],
    ['no symbol', 'NoSymbols1'],
  ])('rejects a password that is %s', async (_label, password) => {
    const conferenceId = await createConference()
    const res = await request(app)
      .post('/api/auth/register')
      .send(validPayload(conferenceId, { email: `${password}@example.com`, password }))
    expect(res.status).toBe(400)
    expect(res.body.error.fields?.password).toBeTruthy()
  })

  it('rejects a name with digits or symbols other than . \' -', async () => {
    const conferenceId = await createConference()
    const res = await request(app)
      .post('/api/auth/register')
      .send(validPayload(conferenceId, { full_name: 'Bad Name 123' }))
    expect(res.status).toBe(400)
    expect(res.body.error.fields?.full_name).toBeTruthy()
  })

  it('rejects an unknown conference id', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(validPayload('00000000-0000-0000-0000-000000000000', { email: 'noconf@example.com' }))
    expect(res.status).toBe(400)
  })

  it('rejects a duplicate email', async () => {
    const conferenceId = await createConference()
    const first = await request(app)
      .post('/api/auth/register')
      .send(validPayload(conferenceId, { email: 'dupe@example.com' }))
    expect(first.status).toBe(201)

    const second = await request(app)
      .post('/api/auth/register')
      .send(validPayload(conferenceId, { email: 'dupe@example.com' }))
    expect(second.status).toBe(409)
  })

  it('rejects an invalid requested_role', async () => {
    const conferenceId = await createConference()
    const res = await request(app)
      .post('/api/auth/register')
      .send(validPayload(conferenceId, { email: 'badrole@example.com', requested_role: 'convenor' }))
    expect(res.status).toBe(400)
  })
})
