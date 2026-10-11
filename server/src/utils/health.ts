import { statfs } from 'node:fs/promises'
import { pool } from '../db/pool.js'
import { STORAGE_ROOT } from '../storage/paths.js'

/** Pings the database with a trivial query, timing the round trip. Never throws — callers get ok:false instead. */
export async function pingDatabase(): Promise<{ ok: boolean; latency_ms: number | null }> {
  const startedAt = Date.now()
  try {
    await pool.query('SELECT 1')
    return { ok: true, latency_ms: Date.now() - startedAt }
  } catch {
    return { ok: false, latency_ms: null }
  }
}

/** Free/total bytes on the filesystem backing server/storage. Never throws — callers get nulls instead. */
export async function getStorageDiskSpace(): Promise<{ free_bytes: number | null; total_bytes: number | null }> {
  try {
    const stats = await statfs(STORAGE_ROOT)
    return { free_bytes: stats.bavail * stats.bsize, total_bytes: stats.blocks * stats.bsize }
  } catch {
    return { free_bytes: null, total_bytes: null }
  }
}
