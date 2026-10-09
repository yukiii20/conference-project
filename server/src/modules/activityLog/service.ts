import { pool } from '../../db/pool.js'
import type { ActivityLogQuery } from './validation.js'

const PAGE_SIZE = 50

export type ActivityLogRow = {
  id: number
  occurred_at: string
  actor_user_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  old_values: unknown
  new_values: unknown
}

function buildQuery(conferenceId: string, filters: ActivityLogQuery): { where: string; params: unknown[] } {
  const conditions = ['a.conference_id = ?']
  const params: unknown[] = [conferenceId]

  if (filters.actor) {
    conditions.push('a.actor_user_id = ?')
    params.push(filters.actor)
  }
  if (filters.action) {
    conditions.push('a.action = ?')
    params.push(filters.action)
  }
  if (filters.from) {
    conditions.push('a.occurred_at >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    conditions.push('a.occurred_at <= ?')
    params.push(filters.to)
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params }
}

export async function listActivityLog(
  conferenceId: string,
  filters: ActivityLogQuery,
): Promise<{ entries: ActivityLogRow[]; page: number }> {
  const { where, params } = buildQuery(conferenceId, filters)
  const offset = (filters.page - 1) * PAGE_SIZE

  const [rows] = await pool.query(
    `SELECT a.id, a.occurred_at, a.actor_user_id, u.full_name AS actor_name, a.action,
            a.entity_type, a.entity_id, a.old_values, a.new_values
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ${where}
     ORDER BY a.occurred_at DESC
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset],
  )
  return { entries: rows as ActivityLogRow[], page: filters.page }
}
