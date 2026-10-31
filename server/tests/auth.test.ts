import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createRoleRequest, createUser, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function slugOf(conferenceId: string): Promise<string> {
  const [rows] = await pool.query('SELECT slug FROM conferences WHERE id = ?', [conferenceId])
  return (rows as Array<{ slug: string }>)[0]!.slug
}

function login(body: Record<string, unknown>) {
  return request(app).post('/api/auth/login').send(body)
}

async function auditCount(action: string, userId: string): Promise<number> {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ? AND actor_user_id = ?', [action, userId])
  return Number((rows as Array<{ n: number }>)[0]!.n)
}

describe('register -> login blocked -> convenor approves -> login ok', () => {
  it('walks the full approval flow at the conference', async () => {
    const conferenceId = await createConference()
    const slug = await slugOf(conferenceId)

    const registerRes = await request(app).post('/api/auth/register').send({
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '9812345678',
      password: 'Str0ng!Pass',
      requested_role: 'author',
      conference_id: conferenceId,
    })
    expect(registerRes.status).toBe(201)

    const blockedRes = await login({ email: 'ada@example.com', password: 'Str0ng!Pass', role: 'author', conference: slug })
    expect(blockedRes.status).toBe(403)
    expect(blockedRes.body.error.code).toBe('pending_approval')
    expect(blockedRes.body.error.message).toMatch(/waiting for the convenor's approval/i)

    const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', ['ada@example.com'])
    const authorId = (rows as Array<{ id: string }>)[0]!.id
    const convenorId = await createUser({ email: 'convenor@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenorId, 'convenor')

    const convenorAgent = request.agent(app)
    const convenorLogin = await convenorAgent
      .post('/api/auth/login')
      .send({ email: 'convenor@example.com', password: 'Str0ng!Pass', role: 'convenor', conference: slug })
    expect(convenorLogin.status).toBe(200)
    expect(convenorLogin.body.conference.slug).toBe(slug)

    const [requestRows] = await pool.query('SELECT id FROM role_requests WHERE user_id = ? AND conference_id = ?', [
      authorId,
      conferenceId,
    ])
    const requestId = (requestRows as Array<{ id: string }>)[0]!.id

    const approveRes = await convenorAgent.post(`/api/role-requests/${requestId}/approve`)
    expect(approveRes.status).toBe(200)

    // The approval notification and email point at this conference's own sign-in page.
    const [notifRows] = await pool.query(`SELECT link_path FROM notifications WHERE user_id = ? AND title = 'Role request approved'`, [authorId])
    expect((notifRows as Array<{ link_path: string }>)[0]!.link_path).toBe(`/c/${slug}/login`)
    const [mailRows] = await pool.query(
      `SELECT template_data FROM email_logs WHERE template_key = 'role_request_approved' AND user_id = ?`,
      [authorId],
    )
    const mailData = (mailRows as Array<{ template_data: unknown }>)[0]!.template_data
    const parsed = (typeof mailData === 'string' ? JSON.parse(mailData) : mailData) as { sign_in_url: string }
    expect(parsed.sign_in_url).toMatch(new RegExp(`/c/${slug}/login$`))

    const okLogin = await login({ email: 'ada@example.com', password: 'Str0ng!Pass', role: 'author', conference: slug })
    expect(okLogin.status).toBe(200)
    expect(okLogin.body.user.email).toBe('ada@example.com')
    expect(okLogin.body.conference.id).toBe(conferenceId)

    const cookieHeader = okLogin.headers['set-cookie']
    const cookieString = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader
    expect(cookieString).toMatch(/HttpOnly/i)

    const [sessionRows] = await pool.query(
      'SELECT conference_id FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [authorId],
    )
    expect((sessionRows as Array<{ conference_id: string }>)[0]!.conference_id).toBe(conferenceId)
  })

  it('accepts the conference by id as well as by slug', async () => {
    const conferenceId = await createConference()
    const userId = await createUser({ email: 'byid@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, userId, 'author')
    const res = await login({ email: 'byid@example.com', password: 'Str0ng!Pass', role: 'author', conference: conferenceId })
    expect(res.status).toBe(200)
  })

  it('requires the conference', async () => {
    await createUser({ email: 'noconf@example.com', password: 'Str0ng!Pass' })
    const res = await login({ email: 'noconf@example.com', password: 'Str0ng!Pass', role: 'author' })
    expect(res.status).toBe(400)
  })
})

describe('membership works only at its own conference', () => {
  it('fails at another conference even with the right password, with an audit entry', async () => {
    const abc = await createConference({ slug: 'abc-conf' })
    await createConference({ slug: 'xyz-conf', name: 'XYZ Summit' })
    const userId = await createUser({ email: 'scoped@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(abc, userId, 'author')

    const ok = await login({ email: 'scoped@example.com', password: 'Str0ng!Pass', role: 'author', conference: 'abc-conf' })
    expect(ok.status).toBe(200)

    const elsewhere = await login({ email: 'scoped@example.com', password: 'Str0ng!Pass', role: 'author', conference: 'xyz-conf' })
    expect(elsewhere.status).toBe(403)
    expect(elsewhere.body.error.code).toBe('no_role_at_conference')
    expect(elsewhere.body.error.message).toBe(
      'This account has no role at XYZ Summit yet. Request a role for this conference, or sign in at a conference where you already have a role.',
    )
    expect(await auditCount('auth.login_refused_conference', userId)).toBe(1)
  })

  it('a wrong password at another conference reveals nothing (generic message, no audit)', async () => {
    const abc = await createConference({ slug: 'abc-two' })
    await createConference({ slug: 'xyz-two' })
    const userId = await createUser({ email: 'quiet@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(abc, userId, 'author')

    const res = await login({ email: 'quiet@example.com', password: 'WrongPassword1!', role: 'author', conference: 'xyz-two' })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Email or password is incorrect.')
    expect(await auditCount('auth.login_refused_conference', userId)).toBe(0)
  })

  it('pending and rejected requests are reported per conference', async () => {
    const a = await createConference({ slug: 'pend-a', name: 'Conf A' })
    const b = await createConference({ slug: 'pend-b', name: 'Conf B' })
    const userId = await createUser({ email: 'perconf@example.com', password: 'Str0ng!Pass' })
    await createRoleRequest(userId, a, 'reviewer', 'pending')
    await pool.query(
      `INSERT INTO role_requests (user_id, conference_id, role_code, status, reject_reason) VALUES (?, ?, 'reviewer', 'rejected', 'Track is full.')`,
      [userId, b],
    )

    const atA = await login({ email: 'perconf@example.com', password: 'Str0ng!Pass', role: 'reviewer', conference: 'pend-a' })
    expect(atA.status).toBe(403)
    expect(atA.body.error.code).toBe('pending_approval')
    expect(atA.body.error.message).toMatch(/Conf A is waiting for the convenor's approval/)

    const atB = await login({ email: 'perconf@example.com', password: 'Str0ng!Pass', role: 'reviewer', conference: 'pend-b' })
    expect(atB.status).toBe(403)
    expect(atB.body.error.code).toBe('request_rejected')
    expect(atB.body.error.message).toBe('Your Reviewer request at Conf B was rejected: Track is full.')
  })

  it('an approved role at one conference does not open another where the request is still pending', async () => {
    const a = await createConference({ slug: 'mix-a' })
    const b = await createConference({ slug: 'mix-b' })
    const userId = await createUser({ email: 'mix@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'reviewer')
    await createRoleRequest(userId, b, 'reviewer', 'pending')

    expect((await login({ email: 'mix@example.com', password: 'Str0ng!Pass', role: 'reviewer', conference: 'mix-a' })).status).toBe(200)
    const atB = await login({ email: 'mix@example.com', password: 'Str0ng!Pass', role: 'reviewer', conference: 'mix-b' })
    expect(atB.status).toBe(403)
    expect(atB.body.error.code).toBe('pending_approval')
  })

  it('names the roles held here when the chosen role is not one of them', async () => {
    const a = await createConference({ slug: 'roles-a', name: 'Roles Conf' })
    const userId = await createUser({ email: 'wrongrole@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'author')
    const res = await login({ email: 'wrongrole@example.com', password: 'Str0ng!Pass', role: 'staff', conference: 'roles-a' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('role_not_held')
    expect(res.body.error.message).toMatch(/Your roles here: Author/)
  })

  it('convenor sign-in is checked per conference', async () => {
    const a = await createConference({ slug: 'conv-a' })
    await createConference({ slug: 'conv-b' })
    const convenorId = await createUser({ email: 'conv@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, convenorId, 'convenor')

    expect((await login({ email: 'conv@example.com', password: 'Str0ng!Pass', role: 'convenor', conference: 'conv-a' })).status).toBe(200)
    const atB = await login({ email: 'conv@example.com', password: 'Str0ng!Pass', role: 'convenor', conference: 'conv-b' })
    expect(atB.status).toBe(403)
    expect(atB.body.error.code).toBe('no_role_at_conference')
  })

  it('signs in at a draft conference only with an active role there (convenors set it up before publishing)', async () => {
    const draft = await createConference({ slug: 'draft-conf', status: 'draft' })
    const convenorId = await createUser({ email: 'draftconv@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(draft, convenorId, 'convenor')
    expect((await login({ email: 'draftconv@example.com', password: 'Str0ng!Pass', role: 'convenor', conference: 'draft-conf' })).status).toBe(200)
  })

  it('an unknown conference is refused (only after the password is right)', async () => {
    await createUser({ email: 'lost@example.com', password: 'Str0ng!Pass' })
    const wrongPw = await login({ email: 'lost@example.com', password: 'WrongPassword1!', role: 'author', conference: 'no-such-conf' })
    expect(wrongPw.status).toBe(401)
    const rightPw = await login({ email: 'lost@example.com', password: 'Str0ng!Pass', role: 'author', conference: 'no-such-conf' })
    expect(rightPw.status).toBe(404)
  })

  it('a deleted conference is refused', async () => {
    const id = await createConference({ slug: 'gone-conf' })
    const userId = await createUser({ email: 'gone@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(id, userId, 'author')
    await pool.query('UPDATE conferences SET deleted_at = NOW(3) WHERE id = ?', [id])
    const res = await login({ email: 'gone@example.com', password: 'Str0ng!Pass', role: 'author', conference: 'gone-conf' })
    expect(res.status).toBe(404)
  })
})

describe('login error messages', () => {
  it('gives the same message for an unknown email and a wrong password', async () => {
    await createConference({ slug: 'msg-conf' })
    await createUser({ email: 'carol@example.com', password: 'Str0ng!Pass' })

    const unknownRes = await login({ email: 'nobody@example.com', password: 'whatever123A!', role: 'author', conference: 'msg-conf' })
    const wrongPasswordRes = await login({ email: 'carol@example.com', password: 'WrongPassword1!', role: 'author', conference: 'msg-conf' })

    expect(unknownRes.status).toBe(401)
    expect(wrongPasswordRes.status).toBe(401)
    expect(unknownRes.body.error.message).toBe('Email or password is incorrect.')
    expect(wrongPasswordRes.body.error.message).toBe(unknownRes.body.error.message)
  })
})

describe('lockout', () => {
  it('locks the account after 5 failed attempts', async () => {
    await createConference({ slug: 'lock-conf' })
    await createUser({ email: 'dave@example.com', password: 'Str0ng!Pass' })

    for (let i = 0; i < 5; i++) {
      const res = await login({ email: 'dave@example.com', password: 'WrongPassword1!', role: 'author', conference: 'lock-conf' })
      expect(res.status).toBe(401)
    }

    const [rows] = await pool.query('SELECT locked_until FROM users WHERE email = ?', ['dave@example.com'])
    const row = (rows as Array<{ locked_until: string | null }>)[0]!
    expect(row.locked_until).not.toBeNull()

    const stillLocked = await login({ email: 'dave@example.com', password: 'Str0ng!Pass', role: 'author', conference: 'lock-conf' })
    expect(stillLocked.status).toBe(401)
    expect(stillLocked.body.error.message).toBe('Email or password is incorrect.')
  })
})
