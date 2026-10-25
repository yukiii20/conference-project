import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { assertConferencePermission } from '../../middleware/auth.js'
import { getEmailQuota } from '../bulkEmail/service.js'
import { insertAuditLog } from '../../utils/audit.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'

type PendingAssignmentRow = {
  assignment_id: string
  due_at: Date
  reviewer_id: string
  full_name: string
  email: string
  title: string
  submission_code: string | null
  conference_id: string
  conference_code: string
  review_reminders_enabled: boolean
  review_reminder_days_before: number[]
  review_overdue_reminder_enabled: boolean
}

const PENDING_ASSIGNMENTS_SQL = `
  SELECT ra.id AS assignment_id, ra.due_at, ra.reviewer_id, u.full_name, u.email,
         s.title, s.submission_code, s.conference_id, c.code AS conference_code,
         cs.review_reminders_enabled, cs.review_reminder_days_before, cs.review_overdue_reminder_enabled
  FROM review_assignments ra
  JOIN users u ON u.id = ra.reviewer_id
  JOIN submissions s ON s.id = ra.submission_id
  JOIN conferences c ON c.id = s.conference_id
  JOIN conference_settings cs ON cs.conference_id = s.conference_id
  WHERE ra.status IN ('assigned', 'in_progress')
`

async function queueReminderEmail(conn: PoolConnection, row: PendingAssignmentRow, kind: 'before' | 'overdue'): Promise<void> {
  const templateKey = kind === 'overdue' ? 'review_overdue' : 'review_reminder'
  const [templateRows] = await conn.query(
    `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = ? LIMIT 1`,
    [templateKey],
  )
  const template = (templateRows as Array<{ subject: string }>)[0]
  const data = {
    full_name: row.full_name,
    title: row.title,
    submission_code: row.submission_code ?? '',
    due_at: new Date(row.due_at).toISOString(),
    conference_code: row.conference_code,
  }
  const subject = template ? renderTemplate(template.subject, data) : kind === 'overdue' ? 'Overdue review' : 'Review reminder'
  await queueEmail(conn, {
    userId: row.reviewer_id,
    conferenceId: row.conference_id,
    recipientEmail: row.email,
    templateKey,
    subject,
    templateData: data,
    entityType: 'review_assignments',
    entityId: row.assignment_id,
  })
}

/** Tries the automatic "sent once" dedupe row; only queues the email if the insert actually happened. Returns whether it sent. */
async function tryAutomaticReminder(conn: PoolConnection, row: PendingAssignmentRow, kind: string): Promise<boolean> {
  const [result] = await conn.query(`INSERT IGNORE INTO review_reminders (assignment_id, kind) VALUES (?, ?)`, [row.assignment_id, kind])
  if ((result as { affectedRows: number }).affectedRows === 0) return false
  await queueReminderEmail(conn, row, kind === 'overdue' ? 'overdue' : 'before')
  return true
}

/**
 * The hourly automatic job: scans every active, not-yet-submitted review
 * assignment across every conference and sends whichever "before due" or
 * "overdue" reminder has crossed its threshold and hasn't gone out yet. Safe
 * to call repeatedly (including right after server startup, for a Render
 * free-plan wake from sleep) - review_reminders' unique key means a
 * duplicate call is always a no-op per assignment/kind.
 */
export async function sendDueReminders(): Promise<void> {
  const [rows] = await pool.query(PENDING_ASSIGNMENTS_SQL)
  const now = Date.now()
  for (const row of rows as PendingAssignmentRow[]) {
    if (!row.review_reminders_enabled) continue
    const dueAt = new Date(row.due_at).getTime()
    const hoursUntilDue = (dueAt - now) / 3_600_000

    const kinds: string[] = []
    if (hoursUntilDue <= 0) {
      if (row.review_overdue_reminder_enabled) kinds.push('overdue')
    } else {
      for (const days of row.review_reminder_days_before ?? []) {
        if (hoursUntilDue <= days * 24) kinds.push(`before_${days}`)
      }
    }

    for (const kind of kinds) {
      await withTransaction(null, (conn) => tryAutomaticReminder(conn, row, kind)).catch((err) =>
        console.error(`Review reminder job: assignment ${row.assignment_id} (${kind}) failed:`, err),
      )
    }
  }
}

/** Sends (or re-sends) a reminder right now for every one of this reviewer's pending assignments in this conference. */
export async function sendManualReminder(actorUserId: string, conferenceId: string, reviewerId: string): Promise<{ sent: number }> {
  await assertConferencePermission(actorUserId, conferenceId, 'review.assign')
  const [rows] = await pool.query(`${PENDING_ASSIGNMENTS_SQL} AND ra.conference_id = ? AND ra.reviewer_id = ?`, [conferenceId, reviewerId])
  const pending = rows as PendingAssignmentRow[]
  if (pending.length === 0) {
    throw new NotFoundError('This reviewer has no pending reviews in this conference.')
  }
  const now = Date.now()
  await withTransaction(actorUserId, async (conn) => {
    for (const row of pending) {
      const kind = new Date(row.due_at).getTime() <= now ? 'overdue' : 'before'
      await queueReminderEmail(conn, row, kind)
      await recordManualReminder(conn, row.assignment_id, actorUserId)
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'review.reminder.send',
      entityType: 'users',
      entityId: reviewerId,
      newValues: { assignment_count: pending.length },
    })
  })
  return { sent: pending.length }
}

/** A manual send always goes out (no dedupe), but is still recorded (upserted, so clicking twice just bumps the timestamp) so "last reminded" shows up for the convenor alongside automatic sends. */
async function recordManualReminder(conn: PoolConnection, assignmentId: string, actorUserId: string): Promise<void> {
  await conn.query(
    `INSERT INTO review_reminders (assignment_id, kind, triggered_by) VALUES (?, 'manual', ?)
     ON DUPLICATE KEY UPDATE sent_at = NOW(3), triggered_by = VALUES(triggered_by)`,
    [assignmentId, actorUserId],
  )
}

/** Sends a manual reminder to every reviewer with at least one pending (not-yet-submitted) assignment in this conference, respecting the daily email cap like any other bulk send. */
export async function sendAllPendingReminders(actorUserId: string, conferenceId: string): Promise<{ reviewers_notified: number }> {
  await assertConferencePermission(actorUserId, conferenceId, 'review.assign')
  const [rows] = await pool.query(`${PENDING_ASSIGNMENTS_SQL} AND ra.conference_id = ?`, [conferenceId])
  const pending = rows as PendingAssignmentRow[]
  if (pending.length === 0) {
    return { reviewers_notified: 0 }
  }
  const reviewerIds = [...new Set(pending.map((r) => r.reviewer_id))]

  const quota = await getEmailQuota(pool)
  if (reviewerIds.length > quota.remainingToday) {
    throw new BadRequestError(
      `Reminding ${reviewerIds.length} reviewer(s) would exceed today's remaining email quota (${quota.remainingToday} of ${quota.dailyLimit} left today). Try again tomorrow, or remind reviewers individually.`,
    )
  }

  const now = Date.now()
  await withTransaction(actorUserId, async (conn) => {
    for (const row of pending) {
      const kind = new Date(row.due_at).getTime() <= now ? 'overdue' : 'before'
      await queueReminderEmail(conn, row, kind)
      await recordManualReminder(conn, row.assignment_id, actorUserId)
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'review.reminder.send_all',
      entityType: 'conferences',
      entityId: conferenceId,
      newValues: { reviewer_count: reviewerIds.length, assignment_count: pending.length },
    })
  })
  return { reviewers_notified: reviewerIds.length }
}

export type PendingReviewerRow = {
  reviewer_id: string
  full_name: string
  email: string
  pending_count: number
  overdue_count: number
  last_reminded_at: Date | null
}

/** For the convenor's Reviewers tab: every active reviewer with at least one pending assignment, their counts, and when they were last reminded (automatic or manual). */
export async function listReviewersWithPendingReviews(actorUserId: string, conferenceId: string): Promise<PendingReviewerRow[]> {
  await assertConferencePermission(actorUserId, conferenceId, 'review.assign')
  const [rows] = await pool.query(
    `SELECT u.id AS reviewer_id, u.full_name, u.email,
            COUNT(*) AS pending_count,
            SUM(ra.due_at < NOW(3)) AS overdue_count,
            (SELECT MAX(rr.sent_at) FROM review_reminders rr WHERE rr.assignment_id IN (
               SELECT ra2.id FROM review_assignments ra2 WHERE ra2.reviewer_id = u.id AND ra2.conference_id = ?
             )) AS last_reminded_at
     FROM review_assignments ra
     JOIN users u ON u.id = ra.reviewer_id
     WHERE ra.conference_id = ? AND ra.status IN ('assigned', 'in_progress')
     GROUP BY u.id, u.full_name, u.email
     ORDER BY overdue_count DESC, pending_count DESC`,
    [conferenceId, conferenceId],
  )
  return (rows as Array<Omit<PendingReviewerRow, 'overdue_count'> & { overdue_count: string | number }>).map((r) => ({
    ...r,
    overdue_count: Number(r.overdue_count ?? 0),
  }))
}
