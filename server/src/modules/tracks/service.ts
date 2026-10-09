import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import type { CreateTrackInput, UpdateTrackInput } from './validation.js'

export type TrackRow = {
  id: string
  code: string | null
  name: string
  description: string | null
  display_order: number
  is_active: boolean
}

export async function listTracks(conferenceId: string): Promise<TrackRow[]> {
  const [rows] = await pool.query(
    `SELECT id, code, name, description, display_order, is_active
     FROM conference_tracks WHERE conference_id = ? ORDER BY display_order`,
    [conferenceId],
  )
  return rows as TrackRow[]
}

export async function createTrack(actorUserId: string, conferenceId: string, input: CreateTrackInput): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    const [orderRows] = await conn.query(
      'SELECT MAX(display_order) AS max_order FROM conference_tracks WHERE conference_id = ?',
      [conferenceId],
    )
    const nextOrder = ((orderRows as Array<{ max_order: number | null }>)[0]?.max_order ?? -1) + 1

    await conn.query(
      `INSERT INTO conference_tracks (conference_id, name, code, description, display_order) VALUES (?, ?, ?, ?, ?)`,
      [conferenceId, input.name, input.code, input.description, nextOrder],
    )
    const [rows] = await conn.query(
      'SELECT id FROM conference_tracks WHERE conference_id = ? AND display_order = ? LIMIT 1',
      [conferenceId, nextOrder],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create the track.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'track.create',
      entityType: 'conference_tracks',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function loadTrackForUpdate(conn: PoolConnection, conferenceId: string, trackId: string): Promise<TrackRow> {
  const [rows] = await conn.query(
    `SELECT id, code, name, description, display_order, is_active FROM conference_tracks
     WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [trackId, conferenceId],
  )
  const row = (rows as TrackRow[])[0]
  if (!row) throw new NotFoundError('This track does not exist.')
  return row
}

export async function updateTrack(
  actorUserId: string,
  conferenceId: string,
  trackId: string,
  input: UpdateTrackInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadTrackForUpdate(conn, conferenceId, trackId)

    const assignments: string[] = []
    const values: unknown[] = []
    const oldValues: Record<string, unknown> = {}
    const newValues: Record<string, unknown> = {}
    for (const key of ['name', 'code', 'description'] as const) {
      if (!(key in input)) continue
      const value = (input as Record<string, unknown>)[key]
      if (value === current[key]) continue
      assignments.push(`${key} = ?`)
      values.push(value)
      oldValues[key] = current[key]
      newValues[key] = value
    }
    if (assignments.length === 0) return

    values.push(trackId)
    await conn.query(`UPDATE conference_tracks SET ${assignments.join(', ')} WHERE id = ?`, values)
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'track.update',
      entityType: 'conference_tracks',
      entityId: trackId,
      oldValues,
      newValues,
    })
  })
}

export async function setTrackActive(
  actorUserId: string,
  conferenceId: string,
  trackId: string,
  isActive: boolean,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadTrackForUpdate(conn, conferenceId, trackId)
    if (current.is_active === isActive) return

    await conn.query('UPDATE conference_tracks SET is_active = ? WHERE id = ?', [isActive, trackId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'track.set_active',
      entityType: 'conference_tracks',
      entityId: trackId,
      oldValues: { is_active: current.is_active },
      newValues: { is_active: isActive },
    })
  })
}

export async function reorderTracks(actorUserId: string, conferenceId: string, trackIds: string[]): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT id FROM conference_tracks WHERE conference_id = ?', [conferenceId])
    const existingIds = new Set((rows as Array<{ id: string }>).map((r) => r.id))
    for (const id of trackIds) {
      if (!existingIds.has(id)) throw new NotFoundError('One of these tracks does not exist.')
    }

    for (const [index, id] of trackIds.entries()) {
      await conn.query('UPDATE conference_tracks SET display_order = ? WHERE id = ? AND conference_id = ?', [
        index,
        id,
        conferenceId,
      ])
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'track.reorder',
      entityType: 'conference_tracks',
      newValues: { track_ids: trackIds },
    })
  })
}
