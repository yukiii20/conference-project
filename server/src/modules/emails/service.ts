import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { assertConferencePermission } from '../../middleware/auth.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import type { ListEmailLogQuery } from './validation.js'

const PAGE_SIZE = 50

// template_data is never returned here — it may still hold an unsent secret
// link, and the row's recipient/subject are already enough to identify it.
export type EmailLogRow = {
  id: number
  conference_id: string | null
  recipient_email: string
  template_key: string
  subject: string
  status: string
  attempts: number
  error_message: string | null
  queued_at: string
  sent_at: string | null
}

const EMAIL_LOG_COLUMNS = `id, conference_id, recipient_email, template_key, subject, status, attempts, error_message, queued_at, sent_at`

export async function listEmailLogForAdmin(filters: ListEmailLogQuery): Promise<{ entries: EmailLogRow[]; page: number }> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filters.status) {
    conditions.push('status = ?')
    params.push(filters.status)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (filters.page - 1) * PAGE_SIZE

  const [rows] = await pool.query(
    `SELECT ${EMAIL_LOG_COLUMNS} FROM email_logs ${where} ORDER BY queued_at DESC LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset],
  )
  return { entries: rows as EmailLogRow[], page: filters.page }
}

export async function listEmailLogForConference(
  actorUserId: string,
  conferenceId: string,
  filters: ListEmailLogQuery,
): Promise<{ entries: EmailLogRow[]; page: number }> {
  await assertConferencePermission(actorUserId, conferenceId, 'email.read')

  const conditions: string[] = ['conference_id = ?']
  const params: unknown[] = [conferenceId]
  if (filters.status) {
    conditions.push('status = ?')
    params.push(filters.status)
  }
  const offset = (filters.page - 1) * PAGE_SIZE

  const [rows] = await pool.query(
    `SELECT ${EMAIL_LOG_COLUMNS} FROM email_logs WHERE ${conditions.join(' AND ')} ORDER BY queued_at DESC LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset],
  )
  return { entries: rows as EmailLogRow[], page: filters.page }
}

async function retryRow(actorUserId: string | null, id: number, conferenceId: string | undefined, ctx: AuditContext): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const conditions = ['id = ?']
    const params: unknown[] = [id]
    if (conferenceId) {
      conditions.push('conference_id = ?')
      params.push(conferenceId)
    }

    const [rows] = await conn.query(
      `SELECT status, recipient_email, template_key, conference_id FROM email_logs WHERE ${conditions.join(' AND ')} LIMIT 1`,
      params,
    )
    const row = (rows as Array<{ status: string; recipient_email: string; template_key: string; conference_id: string | null }>)[0]
    if (!row) throw new NotFoundError('This email log entry does not exist.')
    if (row.status !== 'failed') {
      throw new ConflictError('Only a failed email can be retried.')
    }

    await conn.query(`UPDATE email_logs SET status = 'queued' WHERE id = ?`, [id])

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId: row.conference_id,
      action: 'email.retry',
      entityType: 'email_log',
      entityId: String(id),
      newValues: { recipient_email: row.recipient_email, template_key: row.template_key },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export async function retryEmailAsAdmin(actorUserId: string, id: number, ctx: AuditContext = {}): Promise<void> {
  await retryRow(actorUserId, id, undefined, ctx)
}

export async function retryEmailForConference(
  actorUserId: string,
  conferenceId: string,
  id: number,
  ctx: AuditContext = {},
): Promise<void> {
  await assertConferencePermission(actorUserId, conferenceId, 'email.read')
  await retryRow(actorUserId, id, conferenceId, ctx)
}
