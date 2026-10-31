import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { appendSignInLink } from '../src/email/render.js'
import { generateToken, sha256 } from '../src/utils/crypto.js'
import {
  addConferenceMember,
  addSubmissionAuthor,
  createConference,
  createDirectSession,
  createReviewAssignment,
  createRoleRequest,
  createSubmission,
  createTrack,
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

function as(cookie: string) {
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    put: (url: string) => request(app).put(url).set('Cookie', cookie),
  }
}

async function twoConferences() {
  const a = await createConference({ slug: 'conf-a', name: 'Conference A' })
  const b = await createConference({ slug: 'conf-b', name: 'Conference B' })
  return { a, b }
}

async function auditRows(action: string, userId: string) {
  const [rows] = await pool.query('SELECT conference_id, old_values, new_values FROM audit_logs WHERE action = ? AND actor_user_id = ?', [
    action,
    userId,
  ])
  return rows as Array<{ conference_id: string | null }>
}

describe('a session bound to one conference cannot reach another', () => {
  it('refuses every /api/conferences/<other id>/... route with 403, even where the account is convenor', async () => {
    const { a, b } = await twoConferences()
    const userId = await createUser({ email: 'both-convenor@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'convenor')
    await addConferenceMember(b, userId, 'convenor')

    const atA = as(await createDirectSession(userId, a))
    expect((await atA.get(`/api/conferences/${a}/role-requests`)).status).toBe(200)

    const other = await atA.get(`/api/conferences/${b}/role-requests`)
    expect(other.status).toBe(403)
    expect(other.body.error.code).toBe('wrong_conference')
    expect((await atA.patch(`/api/conferences/${b}`).send({ name: 'Hijacked' })).status).toBe(403)
    expect((await atA.get(`/api/conferences/${b}/my-agenda`)).status).toBe(403)
  })

  it('refuses a submission loaded by id from another conference (author routes and file downloads)', async () => {
    const { a, b } = await twoConferences()
    const authorId = await createUser({ email: 'author-two@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, authorId, 'author')
    await addConferenceMember(b, authorId, 'author')
    const trackB = await createTrack(b, 'Track B')
    const subB = await createSubmission(b, trackB, authorId, { status: 'draft', title: 'Paper at B' })
    await addSubmissionAuthor(subB, { fullName: 'Author Two', email: 'author-two@example.com', userId: authorId })

    const atB = as(await createDirectSession(authorId, b))
    expect((await atB.get(`/api/submissions/${subB}`)).status).toBe(200)

    const atA = as(await createDirectSession(authorId, a))
    expect((await atA.get(`/api/submissions/${subB}`)).status).toBe(403)
    expect((await atA.patch(`/api/submissions/${subB}`).send({ title: 'Changed from A' })).status).toBe(403)
    expect((await atA.get(`/api/submissions/${subB}/files/00000000-0000-0000-0000-000000000000/download`)).status).toBe(403)
  })

  it('refuses a review assignment loaded by id from another conference, and lists only this conference\'s', async () => {
    const { a, b } = await twoConferences()
    const reviewerId = await createUser({ email: 'rev-two@example.com', password: 'Str0ng!Pass' })
    const creatorId = await createUser({ email: 'creator@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, reviewerId, 'reviewer')
    await addConferenceMember(b, reviewerId, 'reviewer')
    const subA = await createSubmission(a, await createTrack(a, 'TA'), creatorId, { status: 'under_review', title: 'A paper' })
    const subB = await createSubmission(b, await createTrack(b, 'TB'), creatorId, { status: 'under_review', title: 'B paper' })
    await createReviewAssignment(a, subA, reviewerId, { dueAt: new Date(Date.now() + 86_400_000) })
    const assignmentB = await createReviewAssignment(b, subB, reviewerId, { dueAt: new Date(Date.now() + 86_400_000) })

    const atA = as(await createDirectSession(reviewerId, a))
    const list = await atA.get('/api/reviewer/assignments')
    expect(list.status).toBe(200)
    expect((list.body.assignments as Array<{ title: string }>).map((x) => x.title)).toEqual(['A paper'])
    expect((await atA.get(`/api/reviewer/assignments?conference_id=${b}`)).status).toBe(403)
    expect((await atA.get(`/api/reviewer/assignments/${assignmentB}`)).status).toBe(403)
    expect((await atA.post(`/api/reviewer/assignments/${assignmentB}/accept`)).status).toBe(403)
  })

  it('refuses approving a role request of another conference, even for its own convenor', async () => {
    const { a, b } = await twoConferences()
    const convenorId = await createUser({ email: 'conv-two@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, convenorId, 'convenor')
    await addConferenceMember(b, convenorId, 'convenor')
    const applicant = await createUser({ email: 'applicant-two@example.com', password: 'Str0ng!Pass' })
    const requestAtB = await createRoleRequest(applicant, b, 'author')

    const atA = as(await createDirectSession(convenorId, a))
    expect((await atA.post(`/api/role-requests/${requestAtB}/approve`)).status).toBe(403)
    const atB = as(await createDirectSession(convenorId, b))
    expect((await atB.post(`/api/role-requests/${requestAtB}/approve`)).status).toBe(200)
  })

  it('a person with roles in two conferences sees only the signed-in conference (roles, notifications)', async () => {
    const { a, b } = await twoConferences()
    const userId = await createUser({ email: 'dual@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'author')
    await addConferenceMember(b, userId, 'reviewer')
    await pool.query(
      `INSERT INTO notifications (user_id, conference_id, type, title) VALUES (?, ?, 'system', 'For A'), (?, ?, 'system', 'For B'), (?, NULL, 'system', 'Account-wide')`,
      [userId, a, userId, b, userId],
    )

    const atA = request.agent(app)
    expect((await atA.post('/api/auth/login').send({ email: 'dual@example.com', password: 'Str0ng!Pass', role: 'author', conference: 'conf-a' })).status).toBe(200)
    const meA = await atA.get('/api/auth/me')
    expect(meA.body.conference.slug).toBe('conf-a')
    expect((meA.body.roles as Array<{ conference_id: string; role_code: string }>).map((r) => [r.conference_id, r.role_code])).toEqual([[a, 'author']])
    const notesA = await atA.get('/api/me/notifications')
    expect((notesA.body.notifications as Array<{ title: string }>).map((n) => n.title).sort()).toEqual(['Account-wide', 'For A'])

    const atB = request.agent(app)
    expect((await atB.post('/api/auth/login').send({ email: 'dual@example.com', password: 'Str0ng!Pass', role: 'reviewer', conference: 'conf-b' })).status).toBe(200)
    const meB = await atB.get('/api/auth/me')
    expect((meB.body.roles as Array<{ conference_id: string }>).every((r) => r.conference_id === b)).toBe(true)
    const notesB = await atB.get('/api/me/notifications')
    expect((notesB.body.notifications as Array<{ title: string }>).map((n) => n.title).sort()).toEqual(['Account-wide', 'For B'])

    // Marking another conference's notification read from A is "not found", not a silent success.
    const [rows] = await pool.query(`SELECT id FROM notifications WHERE title = 'For B'`)
    const forB = (rows as Array<{ id: string }>)[0]!.id
    expect((await atA.post(`/api/me/notifications/${forB}/read`)).status).toBe(404)
  })

  it('platform admin powers never apply inside a conference-bound session', async () => {
    const { a, b } = await twoConferences()
    const adminId = await createUser({ email: 'admin-member@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminId)
    await addConferenceMember(a, adminId, 'author')

    const bound = as(await createDirectSession(adminId, a))
    expect((await bound.get('/api/admin/conferences')).status).toBe(403)
    expect((await bound.get(`/api/conferences/${a}/role-requests`)).status).toBe(403)
    expect((await bound.get(`/api/conferences/${b}/role-requests`)).status).toBe(403)
    expect((await bound.get('/api/auth/me')).body.isAdmin).toBe(false)

    const adminSession = as(await createDirectSession(adminId))
    expect((await adminSession.get('/api/admin/conferences')).status).toBe(200)
    expect((await adminSession.get(`/api/conferences/${b}/role-requests`)).status).toBe(200)
  })

  it('a session made before sessions were scoped (no conference) is no longer valid', async () => {
    const userId = await createUser({ email: 'legacy@example.com', password: 'Str0ng!Pass' })
    const token = generateToken()
    await pool.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 12 HOUR))`,
      [userId, sha256(token)],
    )
    const res = await request(app).get('/api/auth/me').set('Cookie', `cms_session=${token}`)
    expect(res.status).toBe(401)
  })

  it('a session bound to a conference that was deleted ends', async () => {
    const a = await createConference({ slug: 'soon-gone' })
    const userId = await createUser({ email: 'deleted-conf@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'author')
    const cookie = await createDirectSession(userId, a)
    await pool.query('UPDATE conferences SET deleted_at = NOW(3) WHERE id = ?', [a])
    expect((await as(cookie).get('/api/auth/me')).status).toBe(401)
  })
})

describe('"My conferences" switcher', () => {
  it('lists only active memberships as openable and pending ones as waiting; never other conferences', async () => {
    const { a, b } = await twoConferences()
    const c = await createConference({ slug: 'conf-c', name: 'Conference C' })
    await createConference({ slug: 'conf-d', name: 'Conference D' })
    const userId = await createUser({ email: 'switcher@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'author')
    await addConferenceMember(b, userId, 'reviewer')
    await addConferenceMember(b, userId, 'staff')
    await createRoleRequest(userId, c, 'author', 'pending')

    const res = await as(await createDirectSession(userId, a)).get('/api/auth/my-conferences')
    expect(res.status).toBe(200)
    const rows = res.body.conferences as Array<{ slug: string; roles: string[]; pending_roles: string[]; is_current: boolean }>
    expect(rows.map((r) => r.slug)).toEqual(['conf-a', 'conf-b', 'conf-c'])
    expect(rows.find((r) => r.slug === 'conf-a')!.is_current).toBe(true)
    expect(rows.find((r) => r.slug === 'conf-b')!.roles.sort()).toEqual(['reviewer', 'staff'])
    expect(rows.find((r) => r.slug === 'conf-c')!.roles).toEqual([])
    expect(rows.find((r) => r.slug === 'conf-c')!.pending_roles).toEqual(['author'])
  })

  it('switching ends the session and starts one bound to the chosen conference, with an audit entry', async () => {
    const { a, b } = await twoConferences()
    const userId = await createUser({ email: 'switch-me@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'author')
    await addConferenceMember(b, userId, 'reviewer')
    const oldCookie = await createDirectSession(userId, a)

    const res = await as(oldCookie).post('/api/auth/switch-conference').send({ conference_id: b })
    expect(res.status).toBe(200)
    expect(res.body.conference.id).toBe(b)
    expect((res.body.roles as Array<{ conference_id: string }>).every((r) => r.conference_id === b)).toBe(true)

    // The old session is gone.
    expect((await as(oldCookie).get('/api/auth/me')).status).toBe(401)

    const setCookie = res.headers['set-cookie']
    const newCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!
    const me = await as(newCookie).get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.conference.id).toBe(b)
    expect((await as(newCookie).get(`/api/conferences/${a}/my-agenda`)).status).toBe(403)

    const audits = await auditRows('auth.switch_conference', userId)
    expect(audits).toHaveLength(1)
    expect(audits[0]!.conference_id).toBe(b)
  })

  it('refuses a conference with only a pending request, or none at all', async () => {
    const { a, b } = await twoConferences()
    const c = await createConference({ slug: 'conf-c2' })
    const userId = await createUser({ email: 'no-switch@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'author')
    await createRoleRequest(userId, b, 'author', 'pending')
    const cookie = await createDirectSession(userId, a)

    expect((await as(cookie).post('/api/auth/switch-conference').send({ conference_id: b })).status).toBe(403)
    expect((await as(cookie).post('/api/auth/switch-conference').send({ conference_id: c })).status).toBe(403)
    // The refused attempts didn't end the current session.
    expect((await as(cookie).get('/api/auth/me')).status).toBe(200)
  })

  it('is unavailable without a session', async () => {
    const { b } = await twoConferences()
    expect((await request(app).get('/api/auth/my-conferences')).status).toBe(401)
    expect((await request(app).post('/api/auth/switch-conference').send({ conference_id: b })).status).toBe(401)
  })
})

describe('joining another conference with an existing account (not signed in)', () => {
  it('sign-up with an existing email asks for that account\'s password', async () => {
    const { b } = await twoConferences()
    await createUser({ email: 'existing@example.com', password: 'Str0ng!Pass' })
    const res = await request(app).post('/api/auth/register').send({
      full_name: 'Someone Else',
      email: 'existing@example.com',
      phone: '9812345678',
      password: 'Different1!Pass',
      requested_role: 'author',
      conference_id: b,
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('account_exists')
    expect(res.body.error.message).toBe(
      'An account with this email already exists. Enter its password to join this conference, or use another email.',
    )
  })

  it('with the right password: one pending request at this conference, no new user, profile untouched', async () => {
    const { a, b } = await twoConferences()
    const userId = await createUser({ email: 'joiner@example.com', password: 'Str0ng!Pass', fullName: 'Original Name', phone: '+9779811111111' })
    await addConferenceMember(a, userId, 'author')

    const res = await request(app)
      .post('/api/auth/join-conference')
      .send({ email: 'joiner@example.com', password: 'Str0ng!Pass', requested_role: 'reviewer', conference: 'conf-b' })
    expect(res.status).toBe(201)
    expect(res.body.message).toMatch(/sign in at Conference B once the convenor approves/)

    const [users] = await pool.query('SELECT full_name, phone FROM users WHERE email = ?', ['joiner@example.com'])
    expect(users as unknown[]).toHaveLength(1)
    expect((users as Array<{ full_name: string; phone: string }>)[0]).toEqual({ full_name: 'Original Name', phone: '+9779811111111' })
    const [requests] = await pool.query('SELECT conference_id, role_code, status FROM role_requests WHERE user_id = ?', [userId])
    expect(requests).toEqual([{ conference_id: b, role_code: 'reviewer', status: 'pending' }])

    // Still no access at B until approved.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'joiner@example.com', password: 'Str0ng!Pass', role: 'reviewer', conference: 'conf-b' })
    expect(login.body.error.code).toBe('pending_approval')
  })

  it('with the wrong password: refused with the clear message, and counts towards lockout', async () => {
    await twoConferences()
    await createUser({ email: 'joiner-wrong@example.com', password: 'Str0ng!Pass' })
    const res = await request(app)
      .post('/api/auth/join-conference')
      .send({ email: 'joiner-wrong@example.com', password: 'Nope1234!x', requested_role: 'author', conference: 'conf-b' })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe(
      'An account with this email already exists. Enter its password to join this conference, or use another email.',
    )
    const [rows] = await pool.query('SELECT failed_login_count FROM users WHERE email = ?', ['joiner-wrong@example.com'])
    expect((rows as Array<{ failed_login_count: number }>)[0]!.failed_login_count).toBe(1)
    const [requests] = await pool.query('SELECT 1 FROM role_requests')
    expect(requests as unknown[]).toHaveLength(0)
  })

  it('says so clearly when the role is already pending or active here', async () => {
    const { b } = await twoConferences()
    const userId = await createUser({ email: 'already@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(b, userId, 'author')
    await createRoleRequest(userId, b, 'reviewer', 'pending')

    const active = await request(app)
      .post('/api/auth/join-conference')
      .send({ email: 'already@example.com', password: 'Str0ng!Pass', requested_role: 'author', conference: 'conf-b' })
    expect(active.status).toBe(409)
    expect(active.body.error.code).toBe('role_already_active')

    const pending = await request(app)
      .post('/api/auth/join-conference')
      .send({ email: 'already@example.com', password: 'Str0ng!Pass', requested_role: 'reviewer', conference: 'conf-b' })
    expect(pending.status).toBe(409)
    expect(pending.body.error.code).toBe('role_request_pending')
  })

  it('refuses an unpublished or unknown conference', async () => {
    await createConference({ slug: 'draft-join', status: 'draft' })
    await createUser({ email: 'draft-joiner@example.com', password: 'Str0ng!Pass' })
    for (const conference of ['draft-join', 'no-such-conf']) {
      const res = await request(app)
        .post('/api/auth/join-conference')
        .send({ email: 'draft-joiner@example.com', password: 'Str0ng!Pass', requested_role: 'author', conference })
      expect(res.status).toBe(404)
    }
  })
})

describe('requesting a role while signed in at another conference', () => {
  it('creates a pending request for the signed-in person only, without granting access', async () => {
    const { a, b } = await twoConferences()
    const userId = await createUser({ email: 'asker@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'author')
    const cookie = await createDirectSession(userId, a)

    const res = await as(cookie).post('/api/auth/request-role').send({ conference: 'conf-b', requested_role: 'staff' })
    expect(res.status).toBe(201)
    const [rows] = await pool.query('SELECT user_id, conference_id, role_code, status FROM role_requests')
    expect(rows).toEqual([{ user_id: userId, conference_id: b, role_code: 'staff', status: 'pending' }])

    // The session is still bound to A — no access to B.
    expect((await as(cookie).get(`/api/conferences/${b}/my-agenda`)).status).toBe(403)

    const dup = await as(cookie).post('/api/auth/request-role').send({ conference: 'conf-b', requested_role: 'staff' })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('role_request_pending')
  })

  it('refuses roles that are not self-service and unpublished conferences', async () => {
    const a = await createConference({ slug: 'home-conf' })
    await createConference({ slug: 'draft-target', status: 'draft' })
    const userId = await createUser({ email: 'asker2@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'author')
    const cookie = await createDirectSession(userId, a)

    expect((await as(cookie).post('/api/auth/request-role').send({ conference: 'home-conf', requested_role: 'convenor' })).status).toBe(400)
    expect((await as(cookie).post('/api/auth/request-role').send({ conference: 'draft-target', requested_role: 'author' })).status).toBe(404)
    expect((await request(app).post('/api/auth/request-role').send({ conference: 'home-conf', requested_role: 'author' })).status).toBe(401)
  })
})

describe('conference-branded links', () => {
  it('forgot-password from a conference page emails that conference\'s reset link; sign-out returns its slug', async () => {
    const a = await createConference({ slug: 'brand-conf' })
    const userId = await createUser({ email: 'brand@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(a, userId, 'author')

    await request(app).post('/api/auth/forgot-password').send({ email: 'brand@example.com', conference: 'brand-conf' })
    const [rows] = await pool.query(`SELECT template_data FROM email_logs WHERE template_key = 'password_reset' ORDER BY id DESC LIMIT 1`)
    const raw = (rows as Array<{ template_data: unknown }>)[0]!.template_data
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { reset_url: string }
    expect(data.reset_url).toMatch(/\/c\/brand-conf\/reset-password\?token=/)

    const cookie = await createDirectSession(userId, a)
    const out = await as(cookie).post('/api/auth/logout')
    expect(out.body.conference_slug).toBe('brand-conf')
  })

  it('the email worker appends a sign-in link to the conference page when the template lacks one', () => {
    const data = { sign_in_url: 'https://cms.example.com/c/abc/login', conference_name: 'ABC <2026>' }
    const html = appendSignInLink('<p>Approved.</p>', '<p>Approved.</p>', data)
    expect(html).toBe('<p>Approved.</p><p><a href="https://cms.example.com/c/abc/login">Sign in to ABC &lt;2026&gt;</a></p>')
    expect(appendSignInLink('<p>x</p>', '<p>{{sign_in_url}}</p>', data)).toBe('<p>x</p>')
    expect(appendSignInLink('<p>x</p>', '<p>x</p>', { sign_in_url: 'javascript:alert(1)' })).toBe('<p>x</p>')
  })
})
