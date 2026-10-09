import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { addConferenceMember, createConference, createDirectSession, createUser, resetDatabase } from './helpers.js'

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

async function loginAsConvenor(conferenceId: string, email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, 'convenor')
  const cookie = await createDirectSession(userId)
  return cookieAgent(cookie)
}

describe('email templates', () => {
  it('lists the platform templates with placeholders, none customised yet', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'tmpl-conv@example.com')

    const res = await agent.get(`/api/conferences/${conferenceId}/email-templates`)
    expect(res.status).toBe(200)
    const roleApproved = res.body.templates.find((t: { template_key: string }) => t.template_key === 'role_request_approved')
    expect(roleApproved.is_customized).toBe(false)
    expect(roleApproved.placeholders).toContain('full_name')
  })

  it('sanitises the saved HTML, stripping script tags and disallowed attributes', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'tmpl-conv2@example.com')

    const res = await agent.post(`/api/conferences/${conferenceId}/email-templates/account_created`).send({
      subject: 'Welcome {{full_name}}',
      body_html: '<p onclick="evil()">Hi {{full_name}}</p><script>alert(1)</script><a href="javascript:evil()">link</a>',
    })
    expect(res.status).toBe(200)

    const [rows] = await pool.query(
      `SELECT body_html FROM email_templates WHERE conference_id = ? AND template_key = 'account_created'`,
      [conferenceId],
    )
    const bodyHtml = (rows as Array<{ body_html: string }>)[0]!.body_html
    expect(bodyHtml).not.toContain('<script')
    expect(bodyHtml).not.toContain('onclick')
    expect(bodyHtml).not.toContain('javascript:')
    expect(bodyHtml).toContain('<p>Hi {{full_name}}</p>')
  })

  it('resets a customised template back to the platform default', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'tmpl-conv3@example.com')
    await agent.post(`/api/conferences/${conferenceId}/email-templates/account_created`).send({
      subject: 'Custom subject',
      body_html: '<p>Custom body</p>',
    })

    const reset = await agent.post(`/api/conferences/${conferenceId}/email-templates/account_created/reset`)
    expect(reset.status).toBe(200)

    const [rows] = await pool.query(
      `SELECT 1 FROM email_templates WHERE conference_id = ? AND template_key = 'account_created'`,
      [conferenceId],
    )
    expect((rows as unknown[]).length).toBe(0)
  })

  it('previews a template filled with sample data', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'tmpl-conv4@example.com')

    const res = await agent.get(`/api/conferences/${conferenceId}/email-templates/account_created/preview`)
    expect(res.status).toBe(200)
    expect(res.body.html).toContain('Jordan Lee')
    expect(res.body.html).not.toContain('{{full_name}}')
  })

  it('404s on an unknown template key', async () => {
    const conferenceId = await createConference()
    const agent = await loginAsConvenor(conferenceId, 'tmpl-conv5@example.com')
    const res = await agent
      .post(`/api/conferences/${conferenceId}/email-templates/not_a_real_key`)
      .send({ subject: 'A valid subject', body_html: '<p>x</p>' })
    expect(res.status).toBe(404)
  })

  it('is forbidden for a staff member', async () => {
    const conferenceId = await createConference()
    const staffId = await createUser({ email: 'tmpl-staff@example.com', password: 'Str0ng!Pass' })
    await addConferenceMember(conferenceId, staffId, 'staff')
    const cookie = await createDirectSession(staffId)
    const agent = cookieAgent(cookie)

    const res = await agent.get(`/api/conferences/${conferenceId}/email-templates`)
    expect(res.status).toBe(403)
  })
})
