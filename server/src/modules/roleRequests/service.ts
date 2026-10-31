import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { assertConferencePermission } from '../../middleware/auth.js'
import { insertAuditLog } from '../../utils/audit.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import { notifyUser } from '../../utils/notifications.js'
import { conferenceSignInPath, conferenceSignInUrl } from '../../utils/conferenceLinks.js'

async function loadRoleRequestTarget(
  conn: PoolConnection,
  requestId: string,
): Promise<{ userId: string; fullName: string; email: string; roleCode: string; conferenceName: string; conferenceSlug: string }> {
  const [rows] = await conn.query(
    `SELECT u.id AS user_id, u.full_name, u.email, rr.role_code, c.name AS conference_name, c.slug AS conference_slug
     FROM role_requests rr
     JOIN users u ON u.id = rr.user_id
     JOIN conferences c ON c.id = rr.conference_id
     WHERE rr.id = ? LIMIT 1`,
    [requestId],
  )
  const row = (rows as Array<{ user_id: string; full_name: string; email: string; role_code: string; conference_name: string; conference_slug: string }>)[0]
  if (!row) throw new NotFoundError('This role request no longer exists.')
  return {
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    roleCode: row.role_code,
    conferenceName: row.conference_name,
    conferenceSlug: row.conference_slug,
  }
}

const MEMBERS_MANAGE = 'members.manage'

export type RoleRequestRow = {
  id: string
  role_code: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  reject_reason: string | null
  applicant_id: string
  applicant_name: string | null
  applicant_email: string | null
  applicant_phone: string | null
  created_at: string
  reviewed_at: string | null
}

export async function listRoleRequests(
  actorUserId: string,
  conferenceId: string,
  status?: string,
): Promise<RoleRequestRow[]> {
  await assertConferencePermission(actorUserId, conferenceId, MEMBERS_MANAGE)

  const params: unknown[] = [conferenceId]
  let statusClause = ''
  if (status) {
    statusClause = 'AND rr.status = ?'
    params.push(status)
  }

  const [rows] = await pool.query(
    `SELECT rr.id, rr.role_code, rr.status, rr.reject_reason, rr.created_at, rr.reviewed_at,
            u.id AS applicant_id, u.full_name AS applicant_name, u.email AS applicant_email, u.phone AS applicant_phone
     FROM role_requests rr
     JOIN users u ON u.id = rr.user_id
     WHERE rr.conference_id = ? ${statusClause}
     ORDER BY rr.created_at DESC`,
    params,
  )
  return rows as RoleRequestRow[]
}

async function loadRequestConferenceId(requestId: string): Promise<string> {
  const [rows] = await pool.query('SELECT conference_id FROM role_requests WHERE id = ? LIMIT 1', [requestId])
  const row = (rows as Array<{ conference_id: string }>)[0]
  if (!row) throw new NotFoundError('This role request no longer exists.')
  return row.conference_id
}

export async function approveRoleRequest(actorUserId: string, requestId: string): Promise<void> {
  const conferenceId = await loadRequestConferenceId(requestId)
  await assertConferencePermission(actorUserId, conferenceId, MEMBERS_MANAGE)

  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      'SELECT user_id, conference_id, role_code, status FROM role_requests WHERE id = ? FOR UPDATE',
      [requestId],
    )
    const row = (rows as Array<{ user_id: string; conference_id: string; role_code: string; status: string }>)[0]
    if (!row) throw new NotFoundError('This role request no longer exists.')
    if (row.status !== 'pending') {
      throw new BadRequestError('This request has already been reviewed.')
    }

    await conn.query(
      `UPDATE role_requests SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(3) WHERE id = ?`,
      [actorUserId, requestId],
    )

    const [updateResult] = await conn.query(
      `UPDATE conference_members SET status = 'active' WHERE conference_id = ? AND user_id = ? AND role_code = ?`,
      [row.conference_id, row.user_id, row.role_code],
    )
    if ((updateResult as { affectedRows: number }).affectedRows === 0) {
      await conn.query(
        `INSERT INTO conference_members (conference_id, user_id, role_code, added_by) VALUES (?, ?, ?, ?)`,
        [row.conference_id, row.user_id, row.role_code, actorUserId],
      )
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId: row.conference_id,
      action: 'role_request.approve',
      entityType: 'role_requests',
      entityId: requestId,
      newValues: { role_code: row.role_code, user_id: row.user_id },
    })

    const target = await loadRoleRequestTarget(conn, requestId)
    const [templateRows] = await conn.query(
      `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'role_request_approved' LIMIT 1`,
    )
    const template = (templateRows as Array<{ subject: string }>)[0]
    // sign_in_url: the email worker adds a "Sign in" link to this conference's own page.
    const data = {
      full_name: target.fullName,
      role_name: target.roleCode,
      conference_name: target.conferenceName,
      sign_in_url: conferenceSignInUrl(target.conferenceSlug),
    }
    const subject = template ? renderTemplate(template.subject, data) : `Your ${target.roleCode} request was approved`
    await queueEmail(conn, {
      userId: target.userId,
      conferenceId: row.conference_id,
      recipientEmail: target.email,
      templateKey: 'role_request_approved',
      subject,
      templateData: data,
      entityType: 'role_requests',
      entityId: requestId,
    })
    await notifyUser(conn, {
      userId: target.userId,
      conferenceId: row.conference_id,
      type: 'system',
      title: 'Role request approved',
      body: `You're now approved as ${target.roleCode} for ${target.conferenceName}.`,
      linkPath: conferenceSignInPath(target.conferenceSlug),
      entityType: 'role_requests',
      entityId: requestId,
    })
  })
}

export async function rejectRoleRequest(actorUserId: string, requestId: string, reason: string): Promise<void> {
  const conferenceId = await loadRequestConferenceId(requestId)
  await assertConferencePermission(actorUserId, conferenceId, MEMBERS_MANAGE)

  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT status FROM role_requests WHERE id = ? FOR UPDATE', [requestId])
    const row = (rows as Array<{ status: string }>)[0]
    if (!row) throw new NotFoundError('This role request no longer exists.')
    if (row.status !== 'pending') {
      throw new BadRequestError('This request has already been reviewed.')
    }

    await conn.query(
      `UPDATE role_requests SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = NOW(3) WHERE id = ?`,
      [reason, actorUserId, requestId],
    )

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'role_request.reject',
      entityType: 'role_requests',
      entityId: requestId,
      newValues: { reason },
    })

    const target = await loadRoleRequestTarget(conn, requestId)
    const [templateRows] = await conn.query(
      `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'role_request_rejected' LIMIT 1`,
    )
    const template = (templateRows as Array<{ subject: string }>)[0]
    const data = { full_name: target.fullName, role_name: target.roleCode, conference_name: target.conferenceName, reason }
    const subject = template ? renderTemplate(template.subject, data) : `Your ${target.roleCode} request`
    await queueEmail(conn, {
      userId: target.userId,
      conferenceId,
      recipientEmail: target.email,
      templateKey: 'role_request_rejected',
      subject,
      templateData: data,
      entityType: 'role_requests',
      entityId: requestId,
    })
    await notifyUser(conn, {
      userId: target.userId,
      conferenceId,
      type: 'system',
      title: 'Role request rejected',
      body: reason,
      entityType: 'role_requests',
      entityId: requestId,
    })
  })
}
