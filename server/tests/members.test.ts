import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createTrack, createUser, resetDatabase } from './helpers.js'

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
    put: (url: string) => request(app).put(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

describe('members and roles', () => {
  it('lists members and supports search/filter', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAsConvenor(conferenceId, 'members-conv@example.com')
    const reviewerId = await createUser({ email: 'members-rev@example.com', password: 'Str0ng!Pass', fullName: 'Rae Reviewer' })
    await addConferenceMember(conferenceId, reviewerId, 'reviewer')

    const all = await agent.get(`/api/conferences/${conferenceId}/members`)
    expect(all.status).toBe(200)
    expect(all.body.members.length).toBe(2)

    const filtered = await agent.get(`/api/conferences/${conferenceId}/members`).query({ role: 'reviewer' })
    expect(filtered.body.members.length).toBe(1)
    expect(filtered.body.members[0].email).toBe('members-rev@example.com')

    const searched = await agent.get(`/api/conferences/${conferenceId}/members`).query({ q: 'Rae' })
    expect(searched.body.members.length).toBe(1)
  })

  // Inviting creates a PENDING invitation and emails a link; nobody becomes a member (or can
  // sign in to the conference) until they accept it - see modules/invitations.
  it('invites a brand-new user by email: pending invitation and an invitation email, no membership yet', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAsConvenor(conferenceId, 'members-conv2@example.com')

    const res = await agent.post(`/api/conferences/${conferenceId}/members/invite`).send({
      full_name: 'New Reviewer',
      email: 'brand-new-reviewer@example.com',
      phone: '+9779811111199',
      role_code: 'reviewer',
    })
    expect(res.status).toBe(201)
    expect(res.body.new_account).toBe(true)
    expect(res.body.invitation_id).toBeTruthy()

    const [userRows] = await pool.query('SELECT id, password_hash FROM users WHERE email = ?', ['brand-new-reviewer@example.com'])
    const user = (userRows as Array<{ id: string; password_hash: string | null }>)[0]!
    expect(user.password_hash).toBeNull()

    const [memberRows] = await pool.query(
      `SELECT status FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = 'reviewer'`,
      [conferenceId, user.id],
    )
    expect(memberRows as unknown[]).toHaveLength(0)

    const [inviteRows] = await pool.query(
      `SELECT role_code FROM conference_invitations WHERE conference_id = ? AND user_id = ? AND status = 'pending'`,
      [conferenceId, user.id],
    )
    expect((inviteRows as Array<{ role_code: string }>)[0]?.role_code).toBe('reviewer')

    const [emailRows] = await pool.query(`SELECT template_key FROM email_logs WHERE recipient_email = ?`, [
      'brand-new-reviewer@example.com',
    ])
    expect((emailRows as Array<{ template_key: string }>)[0]?.template_key).toBe('member_invitation')

    const list = await agent.get(`/api/conferences/${conferenceId}/members/invitations`)
    expect(list.status).toBe(200)
    expect(list.body.invitations.map((i: { email: string }) => i.email)).toContain('brand-new-reviewer@example.com')
  })

  it('invites an existing account by email too, without touching the account', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAsConvenor(conferenceId, 'members-conv3@example.com')
    const existingUserId = await createUser({ email: 'already-has-account@example.com', password: 'Str0ng!Pass' })

    const res = await agent.post(`/api/conferences/${conferenceId}/members/invite`).send({
      full_name: 'Already Has Account',
      email: 'already-has-account@example.com',
      phone: '+9779811111198',
      role_code: 'staff',
    })
    expect(res.status).toBe(201)
    expect(res.body.new_account).toBe(false)

    const [userRows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [existingUserId])
    expect((userRows as Array<{ password_hash: string | null }>)[0]?.password_hash).toBeTruthy()
    const [memberRows] = await pool.query(`SELECT 1 FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = 'staff'`, [
      conferenceId,
      existingUserId,
    ])
    expect(memberRows as unknown[]).toHaveLength(0)
    const [emailRows] = await pool.query(`SELECT template_key FROM email_logs WHERE user_id = ?`, [existingUserId])
    expect((emailRows as Array<{ template_key: string }>).map((r) => r.template_key)).toContain('member_invitation')
  })

  it('refuses a second invite for the same pending role (409) and a role the person already has (400)', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAsConvenor(conferenceId, 'members-conv4@example.com')
    await createUser({ email: 'dup-reviewer@example.com', password: 'Str0ng!Pass' })
    const body = { full_name: 'Dup Reviewer', email: 'dup-reviewer@example.com', phone: '+9779811111197', role_code: 'reviewer' }
    expect((await agent.post(`/api/conferences/${conferenceId}/members/invite`).send(body)).status).toBe(201)

    const repeat = await agent.post(`/api/conferences/${conferenceId}/members/invite`).send(body)
    expect(repeat.status).toBe(409)
    expect(repeat.body.error.code).toBe('invitation_pending')

    const memberId = await createUser({ email: 'active-reviewer@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, memberId, 'reviewer')
    const already = await agent
      .post(`/api/conferences/${conferenceId}/members/invite`)
      .send({ ...body, email: 'active-reviewer@example.com' })
    expect(already.status).toBe(400)
  })

  it('changes a member role, rejecting a duplicate or the convenor row', async () => {
    const conferenceId = await createConference()
    const { agent, userId: convenorId } = await loginAsConvenor(conferenceId, 'members-conv5@example.com')
    const reviewerUserId = await createUser({ email: 'members-rolechange@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewerUserId, 'reviewer')

    const [rows] = await pool.query(
      `SELECT id FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = 'reviewer'`,
      [conferenceId, reviewerUserId],
    )
    const membershipId = (rows as Array<{ id: string }>)[0]!.id

    const ok = await agent.patch(`/api/conferences/${conferenceId}/members/${membershipId}/role`).send({ role_code: 'staff' })
    expect(ok.status).toBe(200)

    const [convenorRows] = await pool.query(
      `SELECT id FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = 'convenor'`,
      [conferenceId, convenorId],
    )
    const convenorMembershipId = (convenorRows as Array<{ id: string }>)[0]!.id
    const convenorChange = await agent
      .patch(`/api/conferences/${conferenceId}/members/${convenorMembershipId}/role`)
      .send({ role_code: 'staff' })
    expect(convenorChange.status).toBe(400)
  })

  it('blocks self-removal and removing the convenor, allows removing someone else', async () => {
    const conferenceId = await createConference()
    const { agent, userId: convenorId } = await loginAsConvenor(conferenceId, 'members-conv6@example.com')
    const staffUserId = await createUser({ email: 'members-remove@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, staffUserId, 'staff')

    const [convenorRows] = await pool.query(
      `SELECT id FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = 'convenor'`,
      [conferenceId, convenorId],
    )
    const convenorMembershipId = (convenorRows as Array<{ id: string }>)[0]!.id
    const selfRemove = await agent.delete(`/api/conferences/${conferenceId}/members/${convenorMembershipId}`)
    expect(selfRemove.status).toBe(400)

    const [staffRows] = await pool.query(
      `SELECT id FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = 'staff'`,
      [conferenceId, staffUserId],
    )
    const staffMembershipId = (staffRows as Array<{ id: string }>)[0]!.id
    const removeOk = await agent.delete(`/api/conferences/${conferenceId}/members/${staffMembershipId}`)
    expect(removeOk.status).toBe(200)

    const [afterRows] = await pool.query('SELECT status FROM conference_members WHERE id = ?', [staffMembershipId])
    expect((afterRows as Array<{ status: string }>)[0]?.status).toBe('removed')
  })

  it('sets reviewer track coverage', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAsConvenor(conferenceId, 'members-conv7@example.com')
    const reviewerUserId = await createUser({ email: 'members-tracks@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewerUserId, 'reviewer')
    const trackId = await createTrack(conferenceId, 'Systems')

    const res = await agent
      .put(`/api/conferences/${conferenceId}/members/${reviewerUserId}/reviewer-tracks`)
      .send({ track_ids: [trackId] })
    expect(res.status).toBe(200)

    const get = await agent.get(`/api/conferences/${conferenceId}/members/${reviewerUserId}/reviewer-tracks`)
    expect(get.body.track_ids).toEqual([trackId])
  })

  it('is forbidden for a reviewer (no members.manage permission)', async () => {
    const conferenceId = await createConference()
    const reviewerId = await createUser({ email: 'members-perm-rev@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, reviewerId, 'reviewer')
    const cookie = await createDirectSession(reviewerId)
    const agent = cookieAgent(cookie)

    const res = await agent.get(`/api/conferences/${conferenceId}/members`)
    expect(res.status).toBe(403)
  })
})
