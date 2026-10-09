import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { localDateRangeToUtc } from '../../utils/timezone.js'
import { BadRequestError, NotFoundError } from '../../utils/errors.js'
import type { RoomInput, SessionInput } from './validation.js'

export type RoomRow = {
  id: string
  name: string
  building: string | null
  capacity: number | null
  status: 'active' | 'inactive'
}

export async function listRooms(conferenceId: string): Promise<RoomRow[]> {
  const [rows] = await pool.query(
    `SELECT id, name, building, capacity, status FROM rooms WHERE conference_id = ? ORDER BY name`,
    [conferenceId],
  )
  return rows as RoomRow[]
}

export async function createRoom(actorUserId: string, conferenceId: string, input: RoomInput): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await conn.query(`INSERT INTO rooms (conference_id, name, building, capacity) VALUES (?, ?, ?, ?)`, [
      conferenceId,
      input.name,
      input.building,
      input.capacity,
    ])
    const [rows] = await conn.query(
      'SELECT id FROM rooms WHERE conference_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1',
      [conferenceId, input.name],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create the room.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'room.create',
      entityType: 'rooms',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function loadRoom(conn: PoolConnection, conferenceId: string, roomId: string): Promise<RoomRow> {
  const [rows] = await conn.query(
    `SELECT id, name, building, capacity, status FROM rooms WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [roomId, conferenceId],
  )
  const row = (rows as RoomRow[])[0]
  if (!row) throw new NotFoundError('This room does not exist.')
  return row
}

export async function updateRoom(
  actorUserId: string,
  conferenceId: string,
  roomId: string,
  input: RoomInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadRoom(conn, conferenceId, roomId)
    await conn.query('UPDATE rooms SET name = ?, building = ?, capacity = ? WHERE id = ?', [
      input.name,
      input.building,
      input.capacity,
      roomId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'room.update',
      entityType: 'rooms',
      entityId: roomId,
      oldValues: current,
      newValues: input,
    })
  })
}

export async function setRoomStatus(
  actorUserId: string,
  conferenceId: string,
  roomId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadRoom(conn, conferenceId, roomId)
    if (current.status === status) return
    await conn.query('UPDATE rooms SET status = ? WHERE id = ?', [status, roomId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'room.set_status',
      entityType: 'rooms',
      entityId: roomId,
      oldValues: { status: current.status },
      newValues: { status },
    })
  })
}

export type SessionRow = {
  id: string
  title: string
  session_type: string
  track_id: string | null
  room_id: string
  starts_at: string
  ends_at: string
  status: string
}

export async function listSessions(conferenceId: string): Promise<SessionRow[]> {
  const [rows] = await pool.query(
    `SELECT id, title, session_type, track_id, room_id, starts_at, ends_at, status
     FROM conference_sessions WHERE conference_id = ? ORDER BY starts_at`,
    [conferenceId],
  )
  return rows as SessionRow[]
}

async function assertWithinConferenceDates(
  conn: PoolConnection,
  conferenceId: string,
  startsAt: string,
  endsAt: string,
): Promise<void> {
  const [rows] = await conn.query(
    'SELECT start_date, end_date, timezone FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [conferenceId],
  )
  const conference = (rows as Array<{ start_date: string | Date; end_date: string | Date; timezone: string }>)[0]
  if (!conference) throw new NotFoundError('This conference does not exist.')

  const toDateOnly = (v: string | Date) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
  const { startUtc, endUtc } = localDateRangeToUtc(
    toDateOnly(conference.start_date),
    toDateOnly(conference.end_date),
    conference.timezone,
  )

  const sessionStart = new Date(startsAt).getTime()
  const sessionEnd = new Date(endsAt).getTime()
  if (sessionStart < startUtc.getTime() || sessionEnd > endUtc.getTime()) {
    throw new BadRequestError('This session must fall within the conference dates.', {
      starts_at: 'This session must fall within the conference dates.',
    })
  }
}

export async function createSession(
  actorUserId: string,
  conferenceId: string,
  input: SessionInput,
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await assertWithinConferenceDates(conn, conferenceId, input.starts_at, input.ends_at)

    await conn.query(
      `INSERT INTO conference_sessions (conference_id, room_id, track_id, title, session_type, starts_at, ends_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conferenceId,
        input.room_id,
        input.track_id,
        input.title,
        input.session_type,
        new Date(input.starts_at),
        new Date(input.ends_at),
        input.status,
      ],
    )
    const [rows] = await conn.query(
      `SELECT id FROM conference_sessions WHERE conference_id = ? ORDER BY created_at DESC LIMIT 1`,
      [conferenceId],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create the session.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'session.create',
      entityType: 'conference_sessions',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function loadSession(conn: PoolConnection, conferenceId: string, sessionId: string): Promise<SessionRow> {
  const [rows] = await conn.query(
    `SELECT id, title, session_type, track_id, room_id, starts_at, ends_at, status
     FROM conference_sessions WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [sessionId, conferenceId],
  )
  const row = (rows as SessionRow[])[0]
  if (!row) throw new NotFoundError('This session does not exist.')
  return row
}

export async function updateSession(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  input: SessionInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadSession(conn, conferenceId, sessionId)
    await assertWithinConferenceDates(conn, conferenceId, input.starts_at, input.ends_at)

    await conn.query(
      `UPDATE conference_sessions
       SET room_id = ?, track_id = ?, title = ?, session_type = ?, starts_at = ?, ends_at = ?, status = ?
       WHERE id = ?`,
      [
        input.room_id,
        input.track_id,
        input.title,
        input.session_type,
        new Date(input.starts_at),
        new Date(input.ends_at),
        input.status,
        sessionId,
      ],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'session.update',
      entityType: 'conference_sessions',
      entityId: sessionId,
      oldValues: current,
      newValues: input,
    })
  })
}

export async function deleteSession(actorUserId: string, conferenceId: string, sessionId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadSession(conn, conferenceId, sessionId)
    await conn.query('DELETE FROM conference_sessions WHERE id = ?', [sessionId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'session.delete',
      entityType: 'conference_sessions',
      entityId: sessionId,
      oldValues: current,
    })
  })
}

export type PublicScheduleRow = {
  session_id: string
  session_title: string
  session_type: string
  session_starts_at: string
  session_ends_at: string
  room_name: string | null
  track_name: string | null
}

export async function getPublicSchedule(conferenceId: string): Promise<PublicScheduleRow[]> {
  const [rows] = await pool.query(
    `SELECT s.id AS session_id, s.title AS session_title, s.session_type AS session_type,
            s.starts_at AS session_starts_at, s.ends_at AS session_ends_at,
            r.name AS room_name, t.name AS track_name
     FROM conference_sessions s
     JOIN rooms r ON r.id = s.room_id
     LEFT JOIN conference_tracks t ON t.id = s.track_id
     WHERE s.conference_id = ? AND s.status = 'published'
     ORDER BY s.starts_at`,
    [conferenceId],
  )
  return rows as PublicScheduleRow[]
}
