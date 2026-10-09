import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

describe('register -> login blocked -> convenor approves -> login ok', () => {
  it('walks the full approval flow', async () => {
    const conferenceId = await createConference()

    const registerRes = await request(app).post('/api/auth/register').send({
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '9812345678',
      password: 'Str0ng!Pass',
      requested_role: 'author',
      conference_id: conferenceId,
    })
    expect(registerRes.status).toBe(201)

    const blockedRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'Str0ng!Pass', role: 'author' })
    expect(blockedRes.status).toBe(403)
    expect(blockedRes.body.error.message).toMatch(/waiting for the convenor's approval/i)

    const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', ['ada@example.com'])
    const authorId = (rows as Array<{ id: string }>)[0]!.id
    const convenorId = await createUser({ email: 'convenor@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenorId, 'convenor')

    const convenorAgent = request.agent(app)
    const convenorLogin = await convenorAgent
      .post('/api/auth/login')
      .send({ email: 'convenor@example.com', password: 'Str0ng!Pass', role: 'convenor' })
    expect(convenorLogin.status).toBe(200)

    const [requestRows] = await pool.query(
      'SELECT id FROM role_requests WHERE user_id = ? AND conference_id = ?',
      [authorId, conferenceId],
    )
    const requestId = (requestRows as Array<{ id: string }>)[0]!.id

    const approveRes = await convenorAgent.post(`/api/role-requests/${requestId}/approve`)
    expect(approveRes.status).toBe(200)

    const okLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'Str0ng!Pass', role: 'author' })
    expect(okLogin.status).toBe(200)
    expect(okLogin.body.user.email).toBe('ada@example.com')

    const cookieHeader = okLogin.headers['set-cookie']
    const cookieString = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader
    expect(cookieString).toMatch(/HttpOnly/i)
  })
})

describe('rejection', () => {
  it('shows the reject reason on login', async () => {
    const conferenceId = await createConference()
    await createUser({ email: 'bob@example.com', password: 'Str0ng!Pass' })
    const convenorId = await createUser({ email: 'convenor2@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenorId, 'convenor')

    await request(app).post('/api/auth/register').send({
      full_name: 'Bob Builder',
      email: 'bob2@example.com',
      phone: '9812345679',
      password: 'Str0ng!Pass',
      requested_role: 'reviewer',
      conference_id: conferenceId,
    })

    const [rows] = await pool.query('SELECT id FROM role_requests WHERE user_id = (SELECT id FROM users WHERE email = ?)', [
      'bob2@example.com',
    ])
    const requestId = (rows as Array<{ id: string }>)[0]!.id

    const convenorAgent = request.agent(app)
    await convenorAgent
      .post('/api/auth/login')
      .send({ email: 'convenor2@example.com', password: 'Str0ng!Pass', role: 'convenor' })

    const rejectRes = await convenorAgent
      .post(`/api/role-requests/${requestId}/reject`)
      .send({ reason: 'Not enough expertise in this track.' })
    expect(rejectRes.status).toBe(200)

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bob2@example.com', password: 'Str0ng!Pass', role: 'reviewer' })
    expect(loginRes.status).toBe(403)
    expect(loginRes.body.error.message).toBe('Your request was rejected: Not enough expertise in this track.')
  })
})

describe('login error messages', () => {
  it('gives the same message for an unknown email and a wrong password', async () => {
    await createUser({ email: 'carol@example.com', password: 'Str0ng!Pass' })

    const unknownRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever123A!', role: 'author' })
    const wrongPasswordRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'carol@example.com', password: 'WrongPassword1!', role: 'author' })

    expect(unknownRes.status).toBe(401)
    expect(wrongPasswordRes.status).toBe(401)
    expect(unknownRes.body.error.message).toBe('Email or password is incorrect.')
    expect(wrongPasswordRes.body.error.message).toBe(unknownRes.body.error.message)
  })
})

describe('lockout', () => {
  it('locks the account after 5 failed attempts', async () => {
    await createUser({ email: 'dave@example.com', password: 'Str0ng!Pass' })

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'dave@example.com', password: 'WrongPassword1!', role: 'author' })
      expect(res.status).toBe(401)
    }

    const [rows] = await pool.query('SELECT locked_until FROM users WHERE email = ?', ['dave@example.com'])
    const row = (rows as Array<{ locked_until: string | null }>)[0]!
    expect(row.locked_until).not.toBeNull()

    const stillLocked = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dave@example.com', password: 'Str0ng!Pass', role: 'author' })
    expect(stillLocked.status).toBe(401)
    expect(stillLocked.body.error.message).toBe('Email or password is incorrect.')
  })
})
