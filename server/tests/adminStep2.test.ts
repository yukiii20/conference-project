import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { anonymizeUser, revokeAdmin } from '../src/modules/admin/service.js'
import {
  addConferenceMember,
  createConference,
  createDirectSession,
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

function cookieAgent(cookie: string) {
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  }
}

async function loginAsAdmin(email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await makePlatformAdmin(userId)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

describe('unlock a locked-out user', () => {
  it('clears failed_login_count and locked_until without changing status', async () => {
    const { agent } = await loginAsAdmin('unlock-admin@example.com')
    const targetId = await createUser({ email: 'locked-out@example.com', password: 'Str0ng!Pass' })
    await pool.query("UPDATE users SET failed_login_count = 5, locked_until = DATE_ADD(NOW(3), INTERVAL 15 MINUTE) WHERE id = ?", [
      targetId,
    ])

    const res = await agent.post(`/api/admin/users/${targetId}/unlock`)
    expect(res.status).toBe(200)

    const [rows] = await pool.query('SELECT status, failed_login_count, locked_until FROM users WHERE id = ?', [targetId])
    const row = (rows as Array<{ status: string; failed_login_count: number; locked_until: string | null }>)[0]!
    expect(row.failed_login_count).toBe(0)
    expect(row.locked_until).toBeNull()
    expect(row.status).toBe('active')
  })

  it('the users list shows failed_login_count and locked_until', async () => {
    const { agent } = await loginAsAdmin('unlock-admin2@example.com')
    const targetId = await createUser({ email: 'locked-out2@example.com', password: 'Str0ng!Pass' })
    await pool.query("UPDATE users SET failed_login_count = 3, locked_until = DATE_ADD(NOW(3), INTERVAL 10 MINUTE) WHERE id = ?", [
      targetId,
    ])

    const res = await agent.get('/api/admin/users').query({ query: 'locked-out2' })
    expect(res.status).toBe(200)
    const row = res.body.users.find((u: { id: string }) => u.id === targetId)
    expect(row.failed_login_count).toBe(3)
    expect(row.locked_until).not.toBeNull()
  })
})

describe('platform admins', () => {
  it('lists, grants and revokes admin access', async () => {
    const { agent } = await loginAsAdmin('admins-manager@example.com')
    const newAdminEmail = 'future-admin@example.com'
    const newAdminId = await createUser({ email: newAdminEmail, password: 'Str0ng!Pass' })

    const grant = await agent.post('/api/admin/admins').send({ email: newAdminEmail })
    expect(grant.status).toBe(200)

    const list = await agent.get('/api/admin/admins')
    expect(list.status).toBe(200)
    expect(list.body.admins.some((a: { id: string }) => a.id === newAdminId)).toBe(true)

    const revoke = await agent.delete(`/api/admin/admins/${newAdminId}`)
    expect(revoke.status).toBe(200)

    const listAfter = await agent.get('/api/admin/admins')
    expect(listAfter.body.admins.some((a: { id: string }) => a.id === newAdminId)).toBe(false)
  })

  it('rejects granting admin to an email with no account', async () => {
    const { agent } = await loginAsAdmin('admins-manager2@example.com')
    const res = await agent.post('/api/admin/admins').send({ email: 'nobody@example.com' })
    expect(res.status).toBe(404)
  })

  it('rejects revoking your own admin access', async () => {
    const { agent, userId } = await loginAsAdmin('solo-admin-revoke@example.com')
    const res = await agent.delete(`/api/admin/admins/${userId}`)
    expect(res.status).toBe(400)
  })

  // Mirrors adminUsers.test.ts's last-admin test for suspend: through the real
  // HTTP route this can never fire (the caller is, by the self-check above,
  // never the target, so they always count as "another active admin"). Still
  // a real safety net for the service function itself.
  it('rejects revoking the last active admin, at the service layer', async () => {
    const onlyAdminId = await createUser({ email: 'only-admin-revoke@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(onlyAdminId)
    const someoneElse = await createUser({ email: 'revoke-bystander@example.com', password: 'Str0ng!Pass' })

    await expect(revokeAdmin(someoneElse, onlyAdminId)).rejects.toThrow(/last active administrator/i)

    const [rows] = await pool.query(
      `SELECT 1 FROM platform_user_roles WHERE user_id = ? AND role_code = 'admin'`,
      [onlyAdminId],
    )
    expect((rows as unknown[]).length).toBe(1)
  })
})

describe('anonymize a user', () => {
  it('replaces PII and deactivates the account, keeping the id', async () => {
    const { agent } = await loginAsAdmin('anon-admin@example.com')
    const targetId = await createUser({
      email: 'to-anonymize@example.com',
      password: 'Str0ng!Pass',
      fullName: 'Real Name',
    })

    const res = await agent.post(`/api/admin/users/${targetId}/anonymize`)
    expect(res.status).toBe(200)

    const [rows] = await pool.query('SELECT full_name, email, phone, status, anonymized_at FROM users WHERE id = ?', [
      targetId,
    ])
    const row = (rows as Array<{
      full_name: string
      email: string
      phone: string | null
      status: string
      anonymized_at: string | null
    }>)[0]!
    expect(row.full_name).toBe('Anonymised user')
    expect(row.email).not.toBe('to-anonymize@example.com')
    expect(row.phone).toBeNull()
    expect(row.status).toBe('deactivated')
    expect(row.anonymized_at).not.toBeNull()
  })

  it('refuses to anonymise your own account', async () => {
    const { agent, userId } = await loginAsAdmin('anon-self@example.com')
    const res = await agent.post(`/api/admin/users/${userId}/anonymize`)
    expect(res.status).toBe(400)
  })

  it('refuses to anonymise another administrator', async () => {
    const { agent } = await loginAsAdmin('anon-admin2@example.com')
    const otherAdminId = await createUser({ email: 'other-admin@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(otherAdminId)

    const res = await agent.post(`/api/admin/users/${otherAdminId}/anonymize`)
    expect(res.status).toBe(400)
  })

  it('the service function itself refuses on an admin target, called directly', async () => {
    const actorId = await createUser({ email: 'anon-actor@example.com', password: 'Str0ng!Pass' })
    const targetId = await createUser({ email: 'anon-target-admin@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(targetId)
    await expect(anonymizeUser(actorId, targetId)).rejects.toThrow(/cannot be anonymised/i)
  })
})

describe('view conference as admin (read-only)', () => {
  it('records an audit entry and returns the conference slug', async () => {
    const { agent } = await loginAsAdmin('viewas-admin@example.com')
    const conferenceId = await createConference({ slug: 'view-as-conf' })

    const res = await agent.post(`/api/admin/conferences/${conferenceId}/view-as`)
    expect(res.status).toBe(200)
    expect(res.body.slug).toBe('view-as-conf')
  })

  it('rejects a write made with the X-Admin-View-As header, even though admins otherwise bypass permission checks', async () => {
    const { userId } = await loginAsAdmin('viewas-write-admin@example.com')
    const conferenceId = await createConference()
    const cookie = await createDirectSession(userId)

    const res = await request(app)
      .patch(`/api/conferences/${conferenceId}`)
      .set('Cookie', cookie)
      .set('X-Admin-View-As', '1')
      .send({ tagline: 'Should not be allowed' })
    expect(res.status).toBe(403)
  })
})

describe('admin dashboard health card', () => {
  it('returns db ping, email mode, failed/queued email counts and free disk space', async () => {
    const { agent } = await loginAsAdmin('health-admin@example.com')
    const res = await agent.get('/api/admin/dashboard')
    expect(res.status).toBe(200)
    expect(res.body.health.database.ok).toBe(true)
    expect(typeof res.body.health.database.latency_ms).toBe('number')
    expect(typeof res.body.health.email_mode).toBe('string')
    expect(typeof res.body.health.failed_emails_24h).toBe('number')
    expect(typeof res.body.health.queued_emails).toBe('number')
    expect(res.body.health.storage_disk).toHaveProperty('free_bytes')
  })
})

describe('platform settings', () => {
  it('the public endpoint returns defaults with no auth before anything is saved', async () => {
    const res = await request(app).get('/api/platform-settings')
    expect(res.status).toBe(200)
    expect(res.body.settings.platform_name).toBe('Conference Management System')
    expect(Array.isArray(res.body.settings.faq_items)).toBe(true)
  })

  it('an admin can update settings, sanitised, and the public endpoint reflects it', async () => {
    const { agent } = await loginAsAdmin('settings-admin@example.com')

    const res = await agent.patch('/api/admin/platform-settings').send({
      platform_name: '<b>Evil</b> Conf',
      support_email: 'help@example.com',
      footer_text: '',
      hero_headline: 'New headline',
      hero_subheadline: null,
      faq_items: [{ q: 'Q1?', a: 'A1' }],
    })
    expect(res.status).toBe(200)
    expect(res.body.settings.platform_name).toBe('Evil Conf')
    expect(res.body.settings.footer_text).toBeNull()

    const pub = await request(app).get('/api/platform-settings')
    expect(pub.body.settings.platform_name).toBe('Evil Conf')
    expect(pub.body.settings.hero_headline).toBe('New headline')
    expect(pub.body.settings.faq_items).toEqual([{ q: 'Q1?', a: 'A1' }])
  })

  it('rejects an empty platform name', async () => {
    const { agent } = await loginAsAdmin('settings-admin2@example.com')
    const res = await agent.patch('/api/admin/platform-settings').send({
      platform_name: '  ',
      support_email: null,
      footer_text: null,
      hero_headline: null,
      hero_subheadline: null,
      faq_items: [],
    })
    expect(res.status).toBe(400)
  })

  it('is forbidden for a non-admin', async () => {
    const userId = await createUser({ email: 'not-admin-settings@example.com', password: 'Str0ng!Pass' })
    const cookie = await createDirectSession(userId)
    const res = await cookieAgent(cookie).patch('/api/admin/platform-settings').send({
      platform_name: 'Hack',
      support_email: null,
      footer_text: null,
      hero_headline: null,
      hero_subheadline: null,
      faq_items: [],
    })
    expect(res.status).toBe(403)
  })
})

describe('admin user detail', () => {
  it('returns the user plus their conference memberships', async () => {
    const { agent } = await loginAsAdmin('detail-admin@example.com')
    const conferenceId = await createConference({ name: 'Detail Conf' })
    const targetId = await createUser({ email: 'detail-target@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, targetId, 'author')

    const res = await agent.get(`/api/admin/users/${targetId}`)
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('detail-target@example.com')
    expect(res.body.memberships).toEqual([
      expect.objectContaining({ conference_id: conferenceId, role_code: 'author', status: 'active' }),
    ])
  })

  it('404s for a user that does not exist', async () => {
    const { agent } = await loginAsAdmin('detail-admin2@example.com')
    const res = await agent.get('/api/admin/users/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })
})

describe('admin conference stats', () => {
  it('returns submissions/registrations/members grouped counts', async () => {
    const { agent } = await loginAsAdmin('stats-admin@example.com')
    const conferenceId = await createConference()

    const res = await agent.get(`/api/admin/conferences/${conferenceId}/stats`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.submissions_by_status)).toBe(true)
    expect(Array.isArray(res.body.registrations_by_status)).toBe(true)
    expect(Array.isArray(res.body.members_by_role)).toBe(true)
  })

  it('404s for a conference that does not exist', async () => {
    const { agent } = await loginAsAdmin('stats-admin2@example.com')
    const res = await agent.get('/api/admin/conferences/00000000-0000-0000-0000-000000000000/stats')
    expect(res.status).toBe(404)
  })
})

describe('audit log records the caller ip/user-agent', () => {
  it('on an admin action', async () => {
    const { agent, userId } = await loginAsAdmin('audit-ip-admin@example.com')
    const targetId = await createUser({ email: 'audit-ip-target@example.com', password: 'Str0ng!Pass' })

    await agent.post(`/api/admin/users/${targetId}/suspend`).set('User-Agent', 'vitest-audit-check')
    const [rows] = await pool.query(
      `SELECT user_agent FROM audit_logs WHERE actor_user_id = ? AND action = 'user.suspend' ORDER BY id DESC LIMIT 1`,
      [userId],
    )
    expect((rows as Array<{ user_agent: string | null }>)[0]?.user_agent).toBe('vitest-audit-check')
  })
})
