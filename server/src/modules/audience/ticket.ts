import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { env } from '../../config/env.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { NotFoundError, AppError } from '../../utils/errors.js'

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for payment or confirmation',
  confirmed: 'Confirmed',
  waitlisted: 'On the waiting list',
}

type TicketRow = {
  registration_id: string
  registration_number: string
  status: string
  category_name: string
  full_name: string
  email: string
  conference_code: string
  conference_name: string
  slug: string
  start_date: string | Date
  end_date: string | Date
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

/**
 * Queues the "Your ticket" email for the person's live registration in this conference. The
 * email carries the ticket number and a link to the ticket page - never the QR token itself
 * (the QR image only ever comes from the signed-in owner's own endpoint).
 * Returns the email_logs id, or null when the person has no live registration.
 */
export async function queueTicketEmail(conn: PoolConnection, conferenceId: string, userId: string): Promise<number | null> {
  const [rows] = await conn.query(
    `SELECT r.id AS registration_id, r.registration_number, r.status, rc.name AS category_name,
            u.full_name, u.email, c.code AS conference_code, c.name AS conference_name, c.slug, c.start_date, c.end_date
     FROM registrations r
     JOIN registration_categories rc ON rc.id = r.category_id
     JOIN users u ON u.id = r.user_id
     JOIN conferences c ON c.id = r.conference_id
     WHERE r.conference_id = ? AND r.user_id = ? AND r.status <> 'cancelled'
     ORDER BY r.registered_at DESC LIMIT 1`,
    [conferenceId, userId],
  )
  const row = (rows as TicketRow[])[0]
  if (!row) return null

  const [templateRows] = await conn.query(
    `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'audience_ticket' LIMIT 1`,
  )
  const start = dateOnly(row.start_date)
  const end = dateOnly(row.end_date)
  const data = {
    full_name: row.full_name,
    conference_code: row.conference_code,
    conference_name: row.conference_name,
    conference_dates: start === end ? start : `${start} to ${end}`,
    registration_number: row.registration_number,
    category_name: row.category_name,
    status: STATUS_LABELS[row.status] ?? row.status,
    ticket_url: `${env.APP_URL}/c/${row.slug}/ticket`,
  }
  const templateSubject = (templateRows as Array<{ subject: string }>)[0]?.subject ?? '[{{conference_code}}] Your ticket {{registration_number}}'
  return queueEmail(conn, {
    userId,
    conferenceId,
    recipientEmail: row.email,
    templateKey: 'audience_ticket',
    subject: renderTemplate(templateSubject, data),
    templateData: data,
    entityType: 'registrations',
    entityId: row.registration_id,
  })
}

/** "Email me my ticket" from the ticket page. At most 3 per hour per person, counted in email_logs (survives restarts). */
export async function resendTicketEmail(conferenceId: string, userId: string, ctx: AuditContext = {}): Promise<void> {
  const [recent] = await pool.query(
    `SELECT COUNT(*) AS n FROM email_logs
     WHERE user_id = ? AND conference_id = ? AND template_key = 'audience_ticket' AND queued_at > NOW(3) - INTERVAL 1 HOUR`,
    [userId, conferenceId],
  )
  if (Number((recent as Array<{ n: number }>)[0]?.n ?? 0) >= 3) {
    throw new AppError(429, 'Your ticket was already emailed several times in the last hour. Please check your inbox and spam folder.')
  }
  await withTransaction(userId, async (conn) => {
    const id = await queueTicketEmail(conn, conferenceId, userId)
    if (id === null) throw new NotFoundError('You do not have an active registration for this conference.')
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: 'registration.ticket_emailed',
      entityType: 'users',
      entityId: userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}
