import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
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
  }
}

async function loginAsAdmin(email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await makePlatformAdmin(userId)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function insertFailedEmail(conferenceId: string | null = null): Promise<number> {
  const [result] = await pool.query(
    `INSERT INTO email_logs (conference_id, recipient_email, template_key, subject, template_data, status, attempts)
     VALUES (?, 'someone@example.com', 'account_created', 'Welcome', '{}', 'failed', 3)`,
    [conferenceId],
  )
  return (result as { insertId: number }).insertId
}

describe('retrying a failed email', () => {
  it('admin retry requeues the row and writes an audit log entry', async () => {
    const { agent, userId } = await loginAsAdmin('retry-admin@example.com')
    const logId = await insertFailedEmail()

    const res = await agent.post(`/api/admin/email-log/${logId}/retry`)
    expect(res.status).toBe(200)

    const [rows] = await pool.query('SELECT status FROM email_logs WHERE id = ?', [logId])
    expect((rows as Array<{ status: string }>)[0]?.status).toBe('queued')

    const [auditRows] = await pool.query(
      `SELECT actor_user_id, action, entity_type, entity_id FROM audit_logs
       WHERE entity_type = 'email_log' AND entity_id = ?`,
      [String(logId)],
    )
    const entry = (auditRows as Array<{ actor_user_id: string; action: string; entity_type: string; entity_id: string }>)[0]
    expect(entry).toBeDefined()
    expect(entry.actor_user_id).toBe(userId)
    expect(entry.action).toBe('email.retry')
  })

  it('rejects retrying an email that is not in failed status', async () => {
    const { agent } = await loginAsAdmin('retry-admin2@example.com')
    const [result] = await pool.query(
      `INSERT INTO email_logs (recipient_email, template_key, subject, template_data, status, attempts)
       VALUES ('someone@example.com', 'account_created', 'Welcome', '{}', 'sent', 1)`,
    )
    const logId = (result as { insertId: number }).insertId

    const res = await agent.post(`/api/admin/email-log/${logId}/retry`)
    expect(res.status).toBe(409)
  })

  it('a convenor can retry their own conference\'s failed email but not another conference\'s', async () => {
    const conferenceId = await createConference()
    const otherConferenceId = await createConference({ slug: 'retry-other-conf' })
    const convenorId = await createUser({ email: 'retry-convenor@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, convenorId, 'convenor')
    const cookie = await createDirectSession(convenorId)
    const agent = cookieAgent(cookie)

    const ownLogId = await insertFailedEmail(conferenceId)
    const otherLogId = await insertFailedEmail(otherConferenceId)

    const ownRes = await agent.post(`/api/conferences/${conferenceId}/email-log/${ownLogId}/retry`)
    expect(ownRes.status).toBe(200)

    const otherRes = await agent.post(`/api/conferences/${otherConferenceId}/email-log/${otherLogId}/retry`)
    expect(otherRes.status).toBe(403)
  })
})
