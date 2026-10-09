import { pool } from '../db/pool.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** Deletes auth_sessions past their expiry (or revoked) and auth_tokens that are used or expired — nothing anyone could still need. */
export async function runSessionCleanup(): Promise<void> {
  await pool.query(`DELETE FROM auth_sessions WHERE expires_at < NOW(3) OR revoked_at IS NOT NULL`)
  await pool.query(`DELETE FROM auth_tokens WHERE used_at IS NOT NULL OR expires_at < NOW(3)`)
}

let timer: ReturnType<typeof setInterval> | null = null

export function startSessionCleanupJob(): void {
  if (timer) return
  runSessionCleanup().catch((err) => console.error('Session cleanup failed:', err))
  timer = setInterval(() => {
    runSessionCleanup().catch((err) => console.error('Session cleanup failed:', err))
  }, DAY_MS)
}

export function stopSessionCleanupJob(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
