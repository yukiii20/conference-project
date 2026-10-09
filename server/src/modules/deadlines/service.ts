import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import type { UpdateDeadlinesInput } from './validation.js'

export type DeadlineRow = {
  code: string
  name: string
  is_window: boolean
  sort_order: number
  opens_at: string | null
  closes_at: string | null
  is_public: boolean | null
}

export async function listDeadlines(conferenceId: string): Promise<DeadlineRow[]> {
  const [rows] = await pool.query(
    `SELECT t.code, t.name, t.is_window, t.sort_order, d.opens_at, d.closes_at, d.is_public
     FROM deadline_types t
     LEFT JOIN conference_deadlines d ON d.deadline_type = t.code AND d.conference_id = ?
     ORDER BY t.sort_order`,
    [conferenceId],
  )
  // mysql2 returns TINYINT(1) columns as 0/1 numbers, not JS booleans. Left
  // as-is, that number round-trips straight back into the PUT body below
  // (is_public is only ever re-derived from a checkbox's real boolean when
  // the convenor actually toggles it) and fails updateDeadlinesSchema's
  // strict z.boolean() check on every save after the first — exactly the
  // "Please fix the highlighted fields" bug this coercion fixes.
  return (rows as DeadlineRow[]).map((row) => ({
    ...row,
    is_window: Boolean(row.is_window),
    is_public: row.is_public === null ? null : Boolean(row.is_public),
  }))
}

export async function updateDeadlines(
  actorUserId: string,
  conferenceId: string,
  input: UpdateDeadlinesInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [existingRows] = await conn.query(
      `SELECT deadline_type, opens_at, closes_at, is_public FROM conference_deadlines WHERE conference_id = ?`,
      [conferenceId],
    )
    const existingByType = new Map(
      (existingRows as Array<{ deadline_type: string; opens_at: string; closes_at: string | null; is_public: boolean }>).map(
        (r) => [r.deadline_type, r],
      ),
    )

    for (const row of input.deadlines) {
      await conn.query(
        `INSERT INTO conference_deadlines (conference_id, deadline_type, opens_at, closes_at, is_public)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE opens_at = VALUES(opens_at), closes_at = VALUES(closes_at), is_public = VALUES(is_public)`,
        [
          conferenceId,
          row.deadline_type,
          new Date(row.opens_at),
          row.closes_at ? new Date(row.closes_at) : null,
          row.is_public,
        ],
      )

      const previous = existingByType.get(row.deadline_type)
      const changed =
        !previous ||
        new Date(previous.opens_at).getTime() !== new Date(row.opens_at).getTime() ||
        (previous.closes_at ? new Date(previous.closes_at).getTime() : null) !==
          (row.closes_at ? new Date(row.closes_at).getTime() : null) ||
        Boolean(previous.is_public) !== row.is_public
      if (!changed) continue

      await insertAuditLog(conn, {
        actorUserId,
        conferenceId,
        action: 'conference.deadline.update',
        entityType: 'conference_deadlines',
        entityId: row.deadline_type,
        oldValues: previous ?? null,
        newValues: row,
      })
    }
  })
}
