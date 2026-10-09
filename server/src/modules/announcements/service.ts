import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import { notifyUser } from '../../utils/notifications.js'
import type { CreateAnnouncementInput, UpdateAnnouncementInput } from './validation.js'

export type AnnouncementRow = {
  id: string
  title: string
  body: string
  audience: string[]
  status: 'draft' | 'scheduled' | 'published' | 'archived'
  publish_at: string | null
  send_email: boolean
  created_at: string
  updated_at: string
}

const AUDIENCE_TO_ROLE: Record<string, string> = {
  authors: 'author',
  reviewers: 'reviewer',
  session_chairs: 'session_chair',
  staff: 'staff',
}

export async function listAnnouncements(conferenceId: string): Promise<AnnouncementRow[]> {
  const [rows] = await pool.query(
    `SELECT id, title, body, audience, status, publish_at, send_email, created_at, updated_at
     FROM announcements WHERE conference_id = ? ORDER BY created_at DESC`,
    [conferenceId],
  )
  return rows as AnnouncementRow[]
}

export async function createAnnouncement(
  actorUserId: string,
  conferenceId: string,
  input: CreateAnnouncementInput,
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    const [confRows] = await conn.query('SELECT id FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [
      conferenceId,
    ])
    if ((confRows as unknown[]).length === 0) throw new NotFoundError('This conference does not exist.')

    await conn.query(
      `INSERT INTO announcements (conference_id, title, body, audience, status, publish_at, send_email, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conferenceId,
        input.title,
        input.body,
        JSON.stringify(input.audience),
        input.status,
        input.status === 'scheduled' ? new Date(input.publish_at!) : null,
        input.send_email,
        actorUserId,
      ],
    )
    const [rows] = await conn.query(
      'SELECT id FROM announcements WHERE conference_id = ? ORDER BY created_at DESC LIMIT 1',
      [conferenceId],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create the announcement.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'announcement.create',
      entityType: 'announcements',
      entityId: id,
      newValues: { title: input.title, status: input.status, audience: input.audience },
    })

    if (input.status === 'published') {
      await fanOutAnnouncement(conn, conferenceId, id, input.audience, input.send_email)
    }

    return { id }
  })
}

async function loadAnnouncementForUpdate(conn: PoolConnection, conferenceId: string, announcementId: string): Promise<AnnouncementRow> {
  const [rows] = await conn.query(
    `SELECT id, title, body, audience, status, publish_at, send_email, created_at, updated_at
     FROM announcements WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [announcementId, conferenceId],
  )
  const row = (rows as AnnouncementRow[])[0]
  if (!row) throw new NotFoundError('This announcement does not exist.')
  return row
}

export async function updateAnnouncement(
  actorUserId: string,
  conferenceId: string,
  announcementId: string,
  input: UpdateAnnouncementInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadAnnouncementForUpdate(conn, conferenceId, announcementId)
    if (current.status === 'published' || current.status === 'archived') {
      throw new BadRequestError('This announcement has already been published and can no longer be edited.')
    }

    const nextStatus = input.status ?? current.status
    if (nextStatus === 'scheduled' && !(input.publish_at ?? current.publish_at)) {
      throw new BadRequestError('Set a publish date for a scheduled announcement.')
    }

    const assignments: string[] = []
    const values: unknown[] = []
    if (input.title !== undefined) {
      assignments.push('title = ?')
      values.push(input.title)
    }
    if (input.body !== undefined) {
      assignments.push('body = ?')
      values.push(input.body)
    }
    if (input.audience !== undefined) {
      assignments.push('audience = ?')
      values.push(JSON.stringify(input.audience))
    }
    if (input.send_email !== undefined) {
      assignments.push('send_email = ?')
      values.push(input.send_email)
    }
    if (input.status !== undefined) {
      assignments.push('status = ?')
      values.push(input.status)
    }
    if ('publish_at' in input) {
      assignments.push('publish_at = ?')
      values.push(nextStatus === 'scheduled' ? (input.publish_at ? new Date(input.publish_at) : current.publish_at) : null)
    } else if (input.status === 'draft') {
      assignments.push('publish_at = ?')
      values.push(null)
    }
    if (assignments.length === 0) return

    values.push(announcementId)
    await conn.query(`UPDATE announcements SET ${assignments.join(', ')} WHERE id = ?`, values)
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'announcement.update',
      entityType: 'announcements',
      entityId: announcementId,
      oldValues: current,
      newValues: input,
    })
  })
}

export async function deleteAnnouncement(actorUserId: string, conferenceId: string, announcementId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadAnnouncementForUpdate(conn, conferenceId, announcementId)
    if (current.status !== 'draft') {
      throw new BadRequestError('Only a draft announcement can be deleted — archive it instead.')
    }
    await conn.query('DELETE FROM announcements WHERE id = ?', [announcementId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'announcement.delete',
      entityType: 'announcements',
      entityId: announcementId,
      oldValues: current,
    })
  })
}

export async function archiveAnnouncement(actorUserId: string, conferenceId: string, announcementId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadAnnouncementForUpdate(conn, conferenceId, announcementId)
    if (current.status === 'archived') return
    await conn.query(`UPDATE announcements SET status = 'archived' WHERE id = ?`, [announcementId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'announcement.archive',
      entityType: 'announcements',
      entityId: announcementId,
      oldValues: { status: current.status },
      newValues: { status: 'archived' },
    })
  })
}

/**
 * Notifies (and, if requested, emails) every member of the chosen audience —
 * one row per user, never one email with everyone in To. Shared by the
 * "publish now" action and the scheduled-publish job below.
 */
export async function fanOutAnnouncement(
  conn: PoolConnection,
  conferenceId: string,
  announcementId: string,
  audience: string[],
  sendEmail: boolean,
): Promise<void> {
  const [confRows] = await conn.query('SELECT name, code, slug FROM conferences WHERE id = ? LIMIT 1', [conferenceId])
  const conference = (confRows as Array<{ name: string; code: string; slug: string }>)[0]
  if (!conference) return

  const [announcementRows] = await conn.query('SELECT title, body FROM announcements WHERE id = ? LIMIT 1', [
    announcementId,
  ])
  const announcement = (announcementRows as Array<{ title: string; body: string }>)[0]
  if (!announcement) return

  let recipientRows: Array<{ user_id: string; email: string }>
  if (audience.includes('all')) {
    const [rows] = await conn.query(
      `SELECT DISTINCT cm.user_id, u.email FROM conference_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.conference_id = ? AND cm.status = 'active'`,
      [conferenceId],
    )
    recipientRows = rows as Array<{ user_id: string; email: string }>
  } else {
    const roleCodes = audience.map((a) => AUDIENCE_TO_ROLE[a]).filter((r): r is string => Boolean(r))
    if (roleCodes.length === 0) return
    const [rows] = await conn.query(
      `SELECT DISTINCT cm.user_id, u.email FROM conference_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.conference_id = ? AND cm.status = 'active' AND cm.role_code IN (?)`,
      [conferenceId, roleCodes],
    )
    recipientRows = rows as Array<{ user_id: string; email: string }>
  }

  const [templateRows] = await conn.query(
    `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'announcement' LIMIT 1`,
  )
  const template = (templateRows as Array<{ subject: string }>)[0]
  const linkPath = `/c/${conference.slug}#about`

  for (const recipient of recipientRows) {
    await notifyUser(conn, {
      userId: recipient.user_id,
      conferenceId,
      type: 'announcement',
      title: announcement.title,
      body: announcement.body.slice(0, 500),
      linkPath,
      entityType: 'announcements',
      entityId: announcementId,
    })

    if (sendEmail) {
      const data = { conference_code: conference.code, title: announcement.title, body: announcement.body }
      const subject = template ? renderTemplate(template.subject, data) : `[${conference.code}] ${announcement.title}`
      await queueEmail(conn, {
        userId: recipient.user_id,
        conferenceId,
        recipientEmail: recipient.email,
        templateKey: 'announcement',
        subject,
        templateData: data,
        entityType: 'announcements',
        entityId: announcementId,
      })
    }
  }
}

export async function publishAnnouncementNow(actorUserId: string, conferenceId: string, announcementId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadAnnouncementForUpdate(conn, conferenceId, announcementId)
    if (current.status === 'published' || current.status === 'archived') {
      throw new BadRequestError('This announcement has already been published.')
    }

    await conn.query(`UPDATE announcements SET status = 'published' WHERE id = ?`, [announcementId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'announcement.publish',
      entityType: 'announcements',
      entityId: announcementId,
      oldValues: { status: current.status },
      newValues: { status: 'published' },
    })

    const audience = typeof current.audience === 'string' ? JSON.parse(current.audience) : current.audience
    await fanOutAnnouncement(conn, conferenceId, announcementId, audience, current.send_email)
  })
}

/** Publishes every scheduled announcement whose time has come — called by the interval job in server/src/jobs/announcements.ts. */
export async function publishDueAnnouncements(): Promise<number> {
  const [rows] = await pool.query(
    `SELECT id, conference_id FROM announcements WHERE status = 'scheduled' AND publish_at <= NOW(3)`,
  )
  const due = rows as Array<{ id: string; conference_id: string }>
  for (const row of due) {
    await withTransaction(null, async (conn) => {
      const [current] = await conn.query(
        `SELECT audience, send_email, status FROM announcements WHERE id = ? LIMIT 1 FOR UPDATE`,
        [row.id],
      )
      const announcement = (current as Array<{ audience: string; send_email: boolean; status: string }>)[0]
      if (!announcement || announcement.status !== 'scheduled') return

      await conn.query(`UPDATE announcements SET status = 'published' WHERE id = ?`, [row.id])
      await insertAuditLog(conn, {
        actorUserId: null,
        conferenceId: row.conference_id,
        action: 'announcement.publish_scheduled',
        entityType: 'announcements',
        entityId: row.id,
        newValues: { status: 'published' },
      })

      const audience = typeof announcement.audience === 'string' ? JSON.parse(announcement.audience) : announcement.audience
      await fanOutAnnouncement(conn, row.conference_id, row.id, audience, announcement.send_email)
    })
  }
  return due.length
}
