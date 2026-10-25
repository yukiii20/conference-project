import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { sendAllPendingReminders, sendDueReminders, sendManualReminder } from '../src/modules/reviews/reminders.js'
import {
  addConferenceMember,
  createConference,
  createDirectSession,
  createReviewAssignment,
  createSubmission,
  createTrack,
  createUser,
  resetDatabase,
  upsertConferenceSettings,
} from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

function cookieAgent(cookie: string) {
  return { post: (url: string) => request(app).post(url).set('Cookie', cookie) }
}

async function makeMember(conferenceId: string, email: string, roleCode: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await addConferenceMember(conferenceId, userId, roleCode)
  const cookie = await createDirectSession(userId)
  return { agent: cookieAgent(cookie), userId }
}

async function setupAssignment(opts: {
  dueInHours: number
  status?: string
  daysBefore?: number[]
  remindersEnabled?: boolean
  overdueEnabled?: boolean
}) {
  const conferenceId = await createConference()
  const trackId = await createTrack(conferenceId, 'Track A')
  const { userId: authorId } = await makeMember(conferenceId, `author-${Math.random()}@example.com`, 'author')
  const submissionId = await createSubmission(conferenceId, trackId, authorId, { status: 'under_review' })
  const { userId: reviewerId } = await makeMember(conferenceId, `reviewer-${Math.random()}@example.com`, 'reviewer')
  await upsertConferenceSettings(conferenceId, {
    review_reminders_enabled: opts.remindersEnabled ?? true,
    review_reminder_days_before: opts.daysBefore ?? [3, 1],
    review_overdue_reminder_enabled: opts.overdueEnabled ?? true,
  })
  const dueAt = new Date(Date.now() + opts.dueInHours * 3_600_000)
  const assignmentId = await createReviewAssignment(conferenceId, submissionId, reviewerId, { dueAt, status: opts.status ?? 'assigned' })
  return { conferenceId, submissionId, reviewerId, assignmentId }
}

async function reminderKinds(assignmentId: string): Promise<string[]> {
  const [rows] = await pool.query(`SELECT kind FROM review_reminders WHERE assignment_id = ? ORDER BY kind`, [assignmentId])
  return (rows as Array<{ kind: string }>).map((r) => r.kind)
}

async function emailCountFor(assignmentId: string, templateKey: string): Promise<number> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM email_logs WHERE entity_type = 'review_assignments' AND entity_id = ? AND template_key = ?`,
    [assignmentId, templateKey],
  )
  return Number((rows as Array<{ n: number }>)[0]!.n)
}

describe('automatic review reminders', () => {
  it('sends the before_3 reminder once when due within 3 days, and never twice', async () => {
    const { assignmentId } = await setupAssignment({ dueInHours: 71 }) // just under 3 days
    await sendDueReminders()
    expect(await reminderKinds(assignmentId)).toEqual(['before_3'])
    expect(await emailCountFor(assignmentId, 'review_reminder')).toBe(1)

    await sendDueReminders()
    expect(await reminderKinds(assignmentId)).toEqual(['before_3']) // still just once
    expect(await emailCountFor(assignmentId, 'review_reminder')).toBe(1)
  })

  it('sends before_1 once that threshold is crossed, without re-sending before_3', async () => {
    const { assignmentId } = await setupAssignment({ dueInHours: 71 })
    await sendDueReminders() // sends before_3
    // Simulate time passing by moving the stored due_at closer, as if an hour had passed.
    await pool.query(`UPDATE review_assignments SET due_at = DATE_SUB(due_at, INTERVAL 48 HOUR) WHERE id = ?`, [assignmentId])
    await sendDueReminders()
    expect(await reminderKinds(assignmentId)).toEqual(['before_1', 'before_3'])
    expect(await emailCountFor(assignmentId, 'review_reminder')).toBe(2)
  })

  it('sends the overdue reminder once a review is past due, independent of the before_N reminders', async () => {
    const { assignmentId } = await setupAssignment({ dueInHours: -1 })
    await sendDueReminders()
    expect(await reminderKinds(assignmentId)).toEqual(['overdue'])
    expect(await emailCountFor(assignmentId, 'review_overdue')).toBe(1)

    await sendDueReminders()
    expect(await reminderKinds(assignmentId)).toEqual(['overdue']) // still just once
  })

  it('never reminds once the review has been submitted', async () => {
    const { assignmentId } = await setupAssignment({ dueInHours: -1, status: 'completed' })
    await sendDueReminders()
    expect(await reminderKinds(assignmentId)).toEqual([])
  })

  it('respects the reminders-off switch entirely', async () => {
    const { assignmentId } = await setupAssignment({ dueInHours: -1, remindersEnabled: false })
    await sendDueReminders()
    expect(await reminderKinds(assignmentId)).toEqual([])
  })

  it('respects the overdue-only off switch while before_N reminders still work', async () => {
    const { assignmentId } = await setupAssignment({ dueInHours: -1, overdueEnabled: false })
    await sendDueReminders()
    expect(await reminderKinds(assignmentId)).toEqual([]) // already past due, so only the (disabled) overdue branch applied
  })
})

describe('manual review reminders', () => {
  it('"send reminder now" always sends, bypassing the once-only automatic dedupe', async () => {
    const { conferenceId, reviewerId, assignmentId } = await setupAssignment({ dueInHours: 71 })
    await sendDueReminders() // automatic before_3 already sent
    expect(await emailCountFor(assignmentId, 'review_reminder')).toBe(1)

    const { userId: convenorId } = await makeMember(conferenceId, `convenor-${Math.random()}@example.com`, 'convenor')
    const result = await sendManualReminder(convenorId, conferenceId, reviewerId)
    expect(result.sent).toBe(1)
    expect(await emailCountFor(assignmentId, 'review_reminder')).toBe(2) // sent again, on top of the automatic one
  })

  it('a non-convenor/manager cannot send a manual reminder', async () => {
    const { conferenceId, reviewerId } = await setupAssignment({ dueInHours: 71 })
    const { userId: otherReviewerId } = await makeMember(conferenceId, `other-${Math.random()}@example.com`, 'reviewer')
    await expect(sendManualReminder(otherReviewerId, conferenceId, reviewerId)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('"remind all" emails every reviewer with a pending review', async () => {
    const { conferenceId, reviewerId: r1 } = await setupAssignment({ dueInHours: 71 })
    const { userId: convenorId } = await makeMember(conferenceId, `convenor2-${Math.random()}@example.com`, 'convenor')
    const result = await sendAllPendingReminders(convenorId, conferenceId)
    expect(result.reviewers_notified).toBe(1)
    void r1
  })

  it('"remind all" refuses when it would exceed the daily email quota', async () => {
    const { conferenceId } = await setupAssignment({ dueInHours: 71 })
    const { userId: convenorId } = await makeMember(conferenceId, `convenor3-${Math.random()}@example.com`, 'convenor')
    // Fill today's quota to the cap with unrelated queued emails.
    const values = Array.from({ length: 300 }, () => `(?, ?, ?, 'sent', NOW(3))`).join(', ')
    const params: unknown[] = []
    for (let i = 0; i < 300; i++) params.push(`quota-filler-${i}@example.com`, 'quota_test', `Filler ${i}`)
    await pool.query(
      `INSERT INTO email_logs (recipient_email, template_key, subject, status, queued_at) VALUES ${values}`,
      params,
    )
    await expect(sendAllPendingReminders(convenorId, conferenceId)).rejects.toMatchObject({ statusCode: 400 })
  })
})
