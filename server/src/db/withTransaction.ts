import type { PoolConnection } from 'mysql2/promise'
import { pool } from './pool.js'

/**
 * Begins a transaction, sets @app_user_id so the database's own triggers
 * (submission_status_history, audit trails) can record who made the change,
 * runs fn, and commits or rolls back. userId may be null for actions with no
 * authenticated actor (e.g. registration before the account exists).
 */
export async function withTransaction<T>(
  userId: string | null,
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('SET @app_user_id = ?', [userId])
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
