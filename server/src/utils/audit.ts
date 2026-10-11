import type { PoolConnection } from 'mysql2/promise'
import type { Request } from 'express'

/** The caller's ip/user-agent, threaded from the route handler down into an insertAuditLog call. Defaults to {} for callers with no HTTP request (tests calling a service function directly, internal jobs). */
export type AuditContext = { ipAddress?: string | null; userAgent?: string | null }

export function auditContextFrom(req: Request): AuditContext {
  return { ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null }
}

type AuditEntry = {
  actorUserId: string | null
  conferenceId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  oldValues?: unknown
  newValues?: unknown
  ipAddress?: string | null
  userAgent?: string | null
}

/** audit_logs is append-only (triggers block UPDATE/DELETE) — insert only, never touch it again. */
export async function insertAuditLog(conn: PoolConnection, entry: AuditEntry): Promise<void> {
  await conn.query(
    `INSERT INTO audit_logs
       (actor_user_id, conference_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.actorUserId,
      entry.conferenceId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      entry.newValues ? JSON.stringify(entry.newValues) : null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ],
  )
}
