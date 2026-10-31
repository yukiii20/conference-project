import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  createConference,
  createInvitationToken,
  createPendingInviteUser,
  createUser,
  makePlatformAdmin,
  resetDatabase,
} from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function loginAsAdmin(email: string, password: string) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/admin-login').send({ email, password })
  expect(res.status).toBe(200)
  return agent
}

describe('convenor-invite: brand-new email', () => {
  it('creates an account with no password and an invitation token, and appoints them convenor', async () => {
    const adminId = await createUser({ email: 'admin@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminId)
    const conferenceId = await createConference()

    const agent = await loginAsAdmin('admin@example.com', 'Str0ng!Pass')
    const res = await agent.post(`/api/admin/conferences/${conferenceId}/convenor-invite`).send({
      full_name: 'New Convenor',
      email: 'new-convenor@example.com',
      phone: '9812345680',
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ invited: true, appointed: true })

    const [userRows] = await pool.query('SELECT id, password_hash FROM users WHERE email = ?', [
      'new-convenor@example.com',
    ])
    const user = (userRows as Array<{ id: string; password_hash: string | null }>)[0]!
    expect(user.password_hash).toBeNull()

    const [tokenRows] = await pool.query(
      "SELECT used_at, expires_at FROM auth_tokens WHERE user_id = ? AND purpose = 'invitation'",
      [user.id],
    )
    const token = (tokenRows as Array<{ used_at: string | null; expires_at: string }>)[0]!
    expect(token.used_at).toBeNull()
    expect(new Date(token.expires_at).getTime()).toBeGreaterThan(Date.now())

    const [memberRows] = await pool.query(
      "SELECT status FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = 'convenor'",
      [conferenceId, user.id],
    )
    expect((memberRows as Array<{ status: string }>)[0]?.status).toBe('active')

    const [emailRows] = await pool.query("SELECT template_key, status FROM email_logs WHERE recipient_email = ?", [
      'new-convenor@example.com',
    ])
    expect((emailRows as Array<{ template_key: string; status: string }>)[0]).toMatchObject({
      template_key: 'convenor_invitation',
      status: 'queued',
    })
  })

  it('a NULL-password account gets the generic wrong-password message on normal login', async () => {
    const adminId = await createUser({ email: 'admin2@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminId)
    const conferenceId = await createConference()

    const agent = await loginAsAdmin('admin2@example.com', 'Str0ng!Pass')
    await agent.post(`/api/admin/conferences/${conferenceId}/convenor-invite`).send({
      full_name: 'No Password Yet',
      email: 'nopass@example.com',
      phone: '9812345681',
    })

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nopass@example.com', password: 'AnyPassword1!', role: 'convenor', conference: conferenceId })
    expect(loginRes.status).toBe(401)
    expect(loginRes.body.error.message).toBe('Email or password is incorrect.')
  })
})

describe('convenor-invite: existing email', () => {
  it('does not create a new account or token, and appoints the existing account directly', async () => {
    const adminId = await createUser({ email: 'admin3@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminId)
    const existingId = await createUser({ email: 'existing@example.com', password: 'Str0ng!Pass' })
    const conferenceId = await createConference()

    const agent = await loginAsAdmin('admin3@example.com', 'Str0ng!Pass')
    const res = await agent.post(`/api/admin/conferences/${conferenceId}/convenor-invite`).send({
      full_name: 'Existing Person',
      email: 'existing@example.com',
      phone: '9812345682',
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ invited: false, appointed: true })

    const [tokenRows] = await pool.query("SELECT id FROM auth_tokens WHERE user_id = ? AND purpose = 'invitation'", [
      existingId,
    ])
    expect((tokenRows as unknown[]).length).toBe(0)

    const [emailRows] = await pool.query('SELECT id FROM email_logs WHERE recipient_email = ?', ['existing@example.com'])
    expect((emailRows as unknown[]).length).toBe(0)

    const [memberRows] = await pool.query(
      "SELECT status FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = 'convenor'",
      [conferenceId, existingId],
    )
    expect((memberRows as Array<{ status: string }>)[0]?.status).toBe('active')
  })

  it('replaces the previously active convenor in the same transaction', async () => {
    const adminId = await createUser({ email: 'admin4@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminId)
    const oldConvenorId = await createUser({ email: 'old-convenor@example.com', password: 'Str0ng!Pass' })
    const conferenceId = await createConference()
    await addConferenceMember(conferenceId, oldConvenorId, 'convenor', 'active')

    const agent = await loginAsAdmin('admin4@example.com', 'Str0ng!Pass')
    await agent.post(`/api/admin/conferences/${conferenceId}/convenor-invite`).send({
      full_name: 'Replacement Convenor',
      email: 'replacement@example.com',
      phone: '9812345683',
    })

    const [rows] = await pool.query(
      "SELECT u.email, cm.status FROM conference_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conference_id = ? AND cm.role_code = 'convenor'",
      [conferenceId],
    )
    const byEmail = Object.fromEntries((rows as Array<{ email: string; status: string }>).map((r) => [r.email, r.status]))
    expect(byEmail['old-convenor@example.com']).toBe('removed')
    expect(byEmail['replacement@example.com']).toBe('active')
  })
})

describe('accept-invitation', () => {
  it('sets the password, marks the token used, and signs the user in at the conference named in the invitation', async () => {
    const conferenceId = await createConference()
    const userId = await createPendingInviteUser({ email: 'invitee@example.com' })
    await addConferenceMember(conferenceId, userId, 'reviewer')
    const token = await createInvitationToken(userId)

    const agent = request.agent(app)
    const res = await agent.post('/api/auth/accept-invitation').send({ token, password: 'Str0ng!Pass', conference: conferenceId })
    expect(res.status).toBe(200)
    expect(res.body.signed_in).toBe(true)
    expect(res.body.user.email).toBe('invitee@example.com')
    expect(res.body.conference.id).toBe(conferenceId)

    const [tokenRows] = await pool.query('SELECT used_at FROM auth_tokens WHERE user_id = ?', [userId])
    expect((tokenRows as Array<{ used_at: string | null }>)[0]?.used_at).not.toBeNull()

    // Logged in already (from the accept-invitation response's session cookie) — /me should confirm it.
    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe('invitee@example.com')

    // And the password now works for a normal login too.
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'invitee@example.com', password: 'Str0ng!Pass', role: 'convenor', conference: conferenceId })
    // Only a reviewer role was granted, so this fails for the role rather than for the password.
    expect(loginRes.status).toBe(403)
    expect(loginRes.body.error.code).toBe('role_not_held')
  })

  it('sets the password but creates no session when the link names no conference where they hold a role', async () => {
    const userId = await createPendingInviteUser({ email: 'invitee-nosession@example.com' })
    const token = await createInvitationToken(userId)
    const agent = request.agent(app)
    const res = await agent.post('/api/auth/accept-invitation').send({ token, password: 'Str0ng!Pass' })
    expect(res.status).toBe(200)
    expect(res.body.signed_in).toBe(false)
    expect((await agent.get('/api/auth/me')).status).toBe(401)
  })

  it('rejects an expired token', async () => {
    const userId = await createPendingInviteUser({ email: 'expired@example.com' })
    const token = await createInvitationToken(userId, { expired: true })

    const res = await request(app).post('/api/auth/accept-invitation').send({ token, password: 'Str0ng!Pass' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/invalid or has expired/i)
  })

  it('rejects a token that has already been used once', async () => {
    const userId = await createPendingInviteUser({ email: 'reused@example.com' })
    const token = await createInvitationToken(userId)

    const first = await request(app).post('/api/auth/accept-invitation').send({ token, password: 'Str0ng!Pass' })
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/api/auth/accept-invitation')
      .send({ token, password: 'AnotherStr0ng!Pass' })
    expect(second.status).toBe(400)
  })

  it('rejects an unknown token', async () => {
    const res = await request(app)
      .post('/api/auth/accept-invitation')
      .send({ token: 'not-a-real-token', password: 'Str0ng!Pass' })
    expect(res.status).toBe(400)
  })
})

describe('convenor-invite authorization', () => {
  it('refuses a non-admin signed-in user', async () => {
    const userId = await createUser({ email: 'plain-user@example.com', password: 'Str0ng!Pass' })
    void userId
    const conferenceId = await createConference()

    const agent = request.agent(app)
    // No session at all.
    const res = await agent.post(`/api/admin/conferences/${conferenceId}/convenor-invite`).send({
      full_name: 'Someone',
      email: 'someone@example.com',
      phone: '9812345684',
    })
    expect(res.status).toBe(401)
  })
})
