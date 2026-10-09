import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import type { CreateSpeakerInput, UpdateSpeakerInput } from './validation.js'

export type SpeakerRow = {
  id: string
  full_name: string
  designation: string | null
  affiliation: string | null
  bio: string | null
  photo_path: string | null
  speaker_type: string
  display_order: number
  is_public: boolean
}

export async function listSpeakers(conferenceId: string): Promise<SpeakerRow[]> {
  const [rows] = await pool.query(
    `SELECT id, full_name, designation, affiliation, bio, photo_path, speaker_type, display_order, is_public
     FROM conference_speakers WHERE conference_id = ? ORDER BY display_order`,
    [conferenceId],
  )
  return rows as SpeakerRow[]
}

export async function createSpeaker(
  actorUserId: string,
  conferenceId: string,
  input: CreateSpeakerInput,
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    const [orderRows] = await conn.query(
      'SELECT MAX(display_order) AS max_order FROM conference_speakers WHERE conference_id = ?',
      [conferenceId],
    )
    const nextOrder = ((orderRows as Array<{ max_order: number | null }>)[0]?.max_order ?? -1) + 1

    await conn.query(
      `INSERT INTO conference_speakers (conference_id, full_name, designation, affiliation, bio, speaker_type, is_public, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conferenceId,
        input.full_name,
        input.designation ?? null,
        input.affiliation ?? null,
        input.bio ?? null,
        input.speaker_type,
        input.is_public,
        nextOrder,
      ],
    )
    const [rows] = await conn.query(
      'SELECT id FROM conference_speakers WHERE conference_id = ? AND display_order = ? LIMIT 1',
      [conferenceId, nextOrder],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create the speaker.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'speaker.create',
      entityType: 'conference_speakers',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function loadSpeakerForUpdate(conn: PoolConnection, conferenceId: string, speakerId: string): Promise<SpeakerRow> {
  const [rows] = await conn.query(
    `SELECT id, full_name, designation, affiliation, bio, photo_path, speaker_type, display_order, is_public
     FROM conference_speakers WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [speakerId, conferenceId],
  )
  const row = (rows as SpeakerRow[])[0]
  if (!row) throw new NotFoundError('This speaker does not exist.')
  return row
}

export async function updateSpeaker(
  actorUserId: string,
  conferenceId: string,
  speakerId: string,
  input: UpdateSpeakerInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadSpeakerForUpdate(conn, conferenceId, speakerId)

    const assignments: string[] = []
    const values: unknown[] = []
    const oldValues: Record<string, unknown> = {}
    const newValues: Record<string, unknown> = {}
    for (const key of ['full_name', 'designation', 'affiliation', 'bio', 'speaker_type', 'is_public'] as const) {
      if (!(key in input)) continue
      const value = (input as Record<string, unknown>)[key]
      if (value === current[key]) continue
      assignments.push(`${key} = ?`)
      values.push(value)
      oldValues[key] = current[key]
      newValues[key] = value
    }
    if (assignments.length === 0) return

    values.push(speakerId)
    await conn.query(`UPDATE conference_speakers SET ${assignments.join(', ')} WHERE id = ?`, values)
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'speaker.update',
      entityType: 'conference_speakers',
      entityId: speakerId,
      oldValues,
      newValues,
    })
  })
}

export async function deleteSpeaker(actorUserId: string, conferenceId: string, speakerId: string): Promise<{ photoPath: string | null }> {
  return withTransaction(actorUserId, async (conn) => {
    const current = await loadSpeakerForUpdate(conn, conferenceId, speakerId)
    await conn.query('DELETE FROM conference_speakers WHERE id = ?', [speakerId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'speaker.delete',
      entityType: 'conference_speakers',
      entityId: speakerId,
      oldValues: current,
    })
    return { photoPath: current.photo_path }
  })
}

export async function reorderSpeakers(actorUserId: string, conferenceId: string, speakerIds: string[]): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT id FROM conference_speakers WHERE conference_id = ?', [conferenceId])
    const existingIds = new Set((rows as Array<{ id: string }>).map((r) => r.id))
    for (const id of speakerIds) {
      if (!existingIds.has(id)) throw new NotFoundError('One of these speakers does not exist.')
    }
    for (const [index, id] of speakerIds.entries()) {
      await conn.query('UPDATE conference_speakers SET display_order = ? WHERE id = ? AND conference_id = ?', [
        index,
        id,
        conferenceId,
      ])
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'speaker.reorder',
      entityType: 'conference_speakers',
      newValues: { speaker_ids: speakerIds },
    })
  })
}

export async function setSpeakerPhotoPath(
  actorUserId: string,
  conferenceId: string,
  speakerId: string,
  newPath: string | null,
): Promise<string | null> {
  return withTransaction(actorUserId, async (conn) => {
    const current = await loadSpeakerForUpdate(conn, conferenceId, speakerId)
    await conn.query('UPDATE conference_speakers SET photo_path = ? WHERE id = ?', [newPath, speakerId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'speaker.photo_path',
      entityType: 'conference_speakers',
      entityId: speakerId,
      oldValues: { photo_path: current.photo_path },
      newValues: { photo_path: newPath },
    })
    return current.photo_path
  })
}
