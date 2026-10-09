import type { PoolConnection } from 'mysql2/promise'

export type NotificationType =
  | 'submission'
  | 'review'
  | 'acceptance'
  | 'rejection'
  | 'deadline'
  | 'schedule'
  | 'payment'
  | 'certificate'
  | 'announcement'
  | 'system'

type NotifyUserInput = {
  userId: string
  conferenceId?: string | null
  type: NotificationType
  title: string
  body?: string | null
  linkPath?: string | null
  entityType?: string | null
  entityId?: string | null
}

/** The in-app counterpart to queueEmail — call it wherever an email is queued for a known user. */
export async function notifyUser(conn: PoolConnection, input: NotifyUserInput): Promise<void> {
  await conn.query(
    `INSERT INTO notifications (user_id, conference_id, type, title, body, link_path, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.conferenceId ?? null,
      input.type,
      input.title,
      input.body ?? null,
      input.linkPath ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
    ],
  )
}
