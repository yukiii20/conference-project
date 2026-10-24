import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import {
  addConferenceMember,
  addSubmissionAuthor,
  createConference,
  createDirectSession,
  createSubmission,
  createTrack,
  createUser,
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

async function loginAs(conferenceId: string, email: string, roleCode: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, roleCode)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function registerConfirmed(conferenceId: string, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO registration_categories (conference_id, code, name) VALUES (?, 'general', 'General')
     ON DUPLICATE KEY UPDATE code = code`,
    [conferenceId],
  )
  const [catRows] = await pool.query('SELECT id FROM registration_categories WHERE conference_id = ? LIMIT 1', [conferenceId])
  const categoryId = (catRows as Array<{ id: string }>)[0]!.id
  const [confRows] = await pool.query('SELECT code FROM conferences WHERE id = ?', [conferenceId])
  const code = (confRows as Array<{ code: string }>)[0]!.code
  const regNumber = `${code}-R${Math.floor(Math.random() * 1_000_000)}`
  await pool.query(
    `INSERT INTO registrations (conference_id, user_id, category_id, registration_number, status, amount_due, currency, qr_token, confirmed_at)
     VALUES (?, ?, ?, ?, 'confirmed', 0, 'NPR', ?, NOW(3))`,
    [conferenceId, userId, categoryId, regNumber, Math.random().toString(36).slice(2).padEnd(48, '0').slice(0, 48)],
  )
}

async function assignPendingReview(conferenceId: string, submissionId: string, reviewerId: string): Promise<void> {
  await pool.query(
    `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, due_at)
     VALUES (?, ?, ?, 1, DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
    [conferenceId, submissionId, reviewerId],
  )
}

describe('bulk email', () => {
  it('is forbidden for a reviewer, and for a manager without the permission', async () => {
    const conferenceId = await createConference()
    const { agent: reviewerAgent } = await loginAs(conferenceId, 'be-reviewer@example.com', 'reviewer')
    const res1 = await reviewerAgent.get(`/api/conferences/${conferenceId}/bulk-email`)
    expect(res1.status).toBe(403)

    const { agent: managerAgent } = await loginAs(conferenceId, 'be-manager@example.com', 'manager')
    const res2 = await managerAgent.get(`/api/conferences/${conferenceId}/bulk-email`)
    expect(res2.status).toBe(403)
  })

  it('works for a manager once the manager role is granted the permission (platform-wide data change)', async () => {
    await pool.query(
      `INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES ('manager', 'communication.bulk_email')`,
    )
    try {
      const conferenceId = await createConference()
      const { agent } = await loginAs(conferenceId, 'be-manager2@example.com', 'manager')
      const res = await agent.get(`/api/conferences/${conferenceId}/bulk-email`)
      expect(res.status).toBe(200)
    } finally {
      await pool.query(
        `DELETE FROM role_permissions WHERE role_code = 'manager' AND permission_code = 'communication.bulk_email'`,
      )
    }
  })

  it('combines recipient groups and de-dupes by email, preferring the row with an account', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'be-conv@example.com', 'convenor')
    const trackId = await createTrack(conferenceId, 'Track A')

    // An author who is ALSO a confirmed registrant under the same email — must appear once.
    const authorUserId = await createUser({ email: 'be-both@example.com', password: 'Str0ng!Pass' })
    const submissionId = await createSubmission(conferenceId, trackId, authorUserId, { status: 'accepted' })
    await addSubmissionAuthor(submissionId, { fullName: 'Both Groups', email: 'be-both@example.com', userId: authorUserId })
    await registerConfirmed(conferenceId, authorUserId)

    const res = await agent
      .post(`/api/conferences/${conferenceId}/bulk-email/recipients-preview`)
      .send({ groups: ['all_authors', 'attendees_confirmed'] })
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
    expect(res.body.preview[0].email).toBe('be-both@example.com')
  })

  it('authors_accepted and authors_rejected only match their own submission status', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'be-conv2@example.com', 'convenor')
    const trackId = await createTrack(conferenceId, 'Track B')
    const creatorId = await createUser({ email: 'be-creator@example.com', password: 'Str0ng!Pass' })

    const acceptedSub = await createSubmission(conferenceId, trackId, creatorId, { status: 'accepted' })
    await addSubmissionAuthor(acceptedSub, { fullName: 'Accepted Author', email: 'be-accepted@example.com', isCorresponding: false })

    const rejectedSub = await createSubmission(conferenceId, trackId, creatorId, { status: 'rejected' })
    await addSubmissionAuthor(rejectedSub, { fullName: 'Rejected Author', email: 'be-rejected@example.com', isCorresponding: false })

    const acceptedRes = await agent.post(`/api/conferences/${conferenceId}/bulk-email/recipients-preview`).send({ groups: ['authors_accepted'] })
    expect(acceptedRes.body.preview.map((p: { email: string }) => p.email)).toEqual(['be-accepted@example.com'])

    const rejectedRes = await agent.post(`/api/conferences/${conferenceId}/bulk-email/recipients-preview`).send({ groups: ['authors_rejected'] })
    expect(rejectedRes.body.preview.map((p: { email: string }) => p.email)).toEqual(['be-rejected@example.com'])
  })

  it('reviewers_pending only matches reviewers with an assigned/in-progress review', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'be-conv3@example.com', 'convenor')
    const trackId = await createTrack(conferenceId, 'Track C')
    const creatorId = await createUser({ email: 'be-creator2@example.com', password: 'Str0ng!Pass' })
    const submissionId = await createSubmission(conferenceId, trackId, creatorId)

    const { userId: pendingReviewerId } = await loginAs(conferenceId, 'be-pending-reviewer@example.com', 'reviewer')
    await addConferenceMember(conferenceId, creatorId, 'reviewer') // a reviewer with no assignment — must not appear
    await assignPendingReview(conferenceId, submissionId, pendingReviewerId)

    const res = await agent.post(`/api/conferences/${conferenceId}/bulk-email/recipients-preview`).send({ groups: ['reviewers_pending'] })
    expect(res.body.preview.map((p: { email: string }) => p.email)).toEqual(['be-pending-reviewer@example.com'])
  })

  it('rejects an empty recipient_groups array', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'be-conv4@example.com', 'convenor')
    const res = await agent.post(`/api/conferences/${conferenceId}/bulk-email/recipients-preview`).send({ groups: [] })
    expect(res.status).toBe(400)
  })

  it('saves a draft, sends it with rendered {{placeholder}} tokens, and records one recipient row per person', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'be-conv5@example.com', 'convenor')
    const { userId: attendeeId } = await loginAs(conferenceId, 'be-attendee@example.com', 'attendee')
    await registerConfirmed(conferenceId, attendeeId)
    // Give the attendee a distinctive name so the rendered subject is checkable.
    await pool.query('UPDATE users SET full_name = ? WHERE id = ?', ['Priya Sharma', attendeeId])

    const draft = await agent.post(`/api/conferences/${conferenceId}/bulk-email`).send({
      subject: 'Hello {{first_name}}',
      body_html: '<p>Dear {{full_name}}, welcome to {{conference_name}}.</p>',
      recipient_groups: ['attendees_confirmed'],
    })
    expect(draft.status).toBe(201)
    const bulkEmailId = draft.body.id

    const [beforeRows] = await pool.query('SELECT status FROM bulk_emails WHERE id = ?', [bulkEmailId])
    expect((beforeRows as Array<{ status: string }>)[0]!.status).toBe('draft')

    const send = await agent.post(`/api/conferences/${conferenceId}/bulk-email/${bulkEmailId}/send`)
    expect(send.status).toBe(200)
    expect(send.body.recipient_count).toBe(1)

    const [afterRows] = await pool.query('SELECT status, recipient_count FROM bulk_emails WHERE id = ?', [bulkEmailId])
    expect((afterRows as Array<{ status: string; recipient_count: number }>)[0]).toMatchObject({ status: 'sent', recipient_count: 1 })

    const [recipientRows] = await pool.query(
      'SELECT recipient_email, email_log_id FROM bulk_email_recipients WHERE bulk_email_id = ?',
      [bulkEmailId],
    )
    const recipients = recipientRows as Array<{ recipient_email: string; email_log_id: number }>
    expect(recipients).toHaveLength(1)
    expect(recipients[0]!.recipient_email).toBe('be-attendee@example.com')
    expect(recipients[0]!.email_log_id).not.toBeNull()

    const [logRows] = await pool.query('SELECT subject FROM email_logs WHERE id = ?', [recipients[0]!.email_log_id])
    expect((logRows as Array<{ subject: string }>)[0]!.subject).toBe('Hello Priya')

    // Already sent — cannot be sent again, and no longer editable.
    const resend = await agent.post(`/api/conferences/${conferenceId}/bulk-email/${bulkEmailId}/send`)
    expect(resend.status).toBe(400)
    const edit = await agent.patch(`/api/conferences/${conferenceId}/bulk-email/${bulkEmailId}`).send({
      subject: 'Changed',
      body_html: '<p>Changed</p>',
      recipient_groups: ['attendees_confirmed'],
    })
    expect(edit.status).toBe(400)
  })

  it('"send test to me" queues exactly one email to the caller and is not recorded as a recipient', async () => {
    const conferenceId = await createConference()
    const { agent, userId: convenorId } = await loginAs(conferenceId, 'be-conv6@example.com', 'convenor')
    await pool.query('UPDATE users SET full_name = ? WHERE id = ?', ['Test Convenor', convenorId])

    const draft = await agent.post(`/api/conferences/${conferenceId}/bulk-email`).send({
      subject: 'Draft subject',
      body_html: '<p>Draft body</p>',
      recipient_groups: ['attendees_confirmed'],
    })
    const bulkEmailId = draft.body.id

    const test = await agent.post(`/api/conferences/${conferenceId}/bulk-email/${bulkEmailId}/test`)
    expect(test.status).toBe(200)

    const [emailRows] = await pool.query(`SELECT recipient_email, subject FROM email_logs WHERE template_key = 'bulk_email'`)
    const emails = emailRows as Array<{ recipient_email: string; subject: string }>
    expect(emails).toHaveLength(1)
    expect(emails[0]!.recipient_email).toBe('be-conv6@example.com')
    expect(emails[0]!.subject).toContain('[Test]')

    const [recipientRows] = await pool.query('SELECT 1 FROM bulk_email_recipients WHERE bulk_email_id = ?', [bulkEmailId])
    expect((recipientRows as unknown[]).length).toBe(0)
  })

  it('refuses to send more recipients than remain in today’s quota', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'be-conv7@example.com', 'convenor')
    const { userId: attendeeId } = await loginAs(conferenceId, 'be-attendee2@example.com', 'attendee')
    await registerConfirmed(conferenceId, attendeeId)

    // Fill the daily quota (300) with other already-queued mail.
    const values: string[] = []
    const params: unknown[] = []
    for (let i = 0; i < 300; i++) {
      values.push('(?, ?, ?, ?, ?, ?)')
      params.push(`quota-filler-${i}@example.com`, 'announcement', 'Filler', '{}', 'sent', conferenceId)
    }
    await pool.query(
      `INSERT INTO email_logs (recipient_email, template_key, subject, template_data, status, conference_id) VALUES ${values.join(',')}`,
      params,
    )

    const draft = await agent.post(`/api/conferences/${conferenceId}/bulk-email`).send({
      subject: 'Over quota',
      body_html: '<p>Over quota</p>',
      recipient_groups: ['attendees_confirmed'],
    })
    const bulkEmailId = draft.body.id

    const preview = await agent.post(`/api/conferences/${conferenceId}/bulk-email/recipients-preview`).send({ groups: ['attendees_confirmed'] })
    expect(preview.body.remaining_today).toBe(0)

    const send = await agent.post(`/api/conferences/${conferenceId}/bulk-email/${bulkEmailId}/send`)
    expect(send.status).toBe(400)
    expect(send.body.error.message).toMatch(/quota/i)
  })

  it('deletes a draft but not a sent bulk email', async () => {
    const conferenceId = await createConference()
    const { agent } = await loginAs(conferenceId, 'be-conv8@example.com', 'convenor')
    const { userId: attendeeId } = await loginAs(conferenceId, 'be-attendee3@example.com', 'attendee')
    await registerConfirmed(conferenceId, attendeeId)

    const draft = await agent.post(`/api/conferences/${conferenceId}/bulk-email`).send({
      subject: 'To delete',
      body_html: '<p>Body</p>',
      recipient_groups: ['attendees_confirmed'],
    })
    const del = await agent.delete(`/api/conferences/${conferenceId}/bulk-email/${draft.body.id}`)
    expect(del.status).toBe(200)

    const draft2 = await agent.post(`/api/conferences/${conferenceId}/bulk-email`).send({
      subject: 'To send then try delete',
      body_html: '<p>Body</p>',
      recipient_groups: ['attendees_confirmed'],
    })
    await agent.post(`/api/conferences/${conferenceId}/bulk-email/${draft2.body.id}/send`)
    const del2 = await agent.delete(`/api/conferences/${conferenceId}/bulk-email/${draft2.body.id}`)
    expect(del2.status).toBe(400)
  })
})
