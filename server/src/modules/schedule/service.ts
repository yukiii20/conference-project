import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { localDateRangeToUtc } from '../../utils/timezone.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { notifyUser } from '../../utils/notifications.js'
import { isPlatformAdmin, getConferencePermissions } from '../auth/service.js'
import { BadRequestError, ForbiddenError, NotFoundError, mapDatabaseError } from '../../utils/errors.js'
import type {
  AddPaperPresentationInput,
  AddSpeakerPresentationInput,
  CopyDayInput,
  RoomInput,
  ScheduleSlotInput,
  SessionChairInput,
  SessionInput,
} from './validation.js'

const DEFAULT_PRESENTATION_MINUTES = 15

// -----------------------------------------------------------------------
// Rooms
// -----------------------------------------------------------------------

export type RoomRow = {
  id: string
  name: string
  room_number: string | null
  building: string | null
  floor: string | null
  capacity: number | null
  equipment: string[]
  description: string | null
  status: 'active' | 'inactive'
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export async function listRooms(conferenceId: string): Promise<RoomRow[]> {
  const [rows] = await pool.query(
    `SELECT id, name, room_number, building, floor, capacity, equipment, description, status
     FROM rooms WHERE conference_id = ? ORDER BY name`,
    [conferenceId],
  )
  return (rows as Array<Omit<RoomRow, 'equipment'> & { equipment: unknown }>).map((r) => ({
    ...r,
    equipment: parseJsonArray(r.equipment),
  }))
}

export async function createRoom(actorUserId: string, conferenceId: string, input: RoomInput): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await conn.query(
      `INSERT INTO rooms (conference_id, name, room_number, building, floor, capacity, equipment, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conferenceId,
        input.name,
        input.room_number,
        input.building,
        input.floor,
        input.capacity,
        JSON.stringify(input.equipment),
        input.description,
      ],
    )
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
    `SELECT id, name, room_number, building, floor, capacity, equipment, description, status
     FROM rooms WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [roomId, conferenceId],
  )
  const row = (rows as Array<Omit<RoomRow, 'equipment'> & { equipment: unknown }>)[0]
  if (!row) throw new NotFoundError('This room does not exist.')
  return { ...row, equipment: parseJsonArray(row.equipment) }
}

export async function updateRoom(
  actorUserId: string,
  conferenceId: string,
  roomId: string,
  input: RoomInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadRoom(conn, conferenceId, roomId)
    await conn.query(
      `UPDATE rooms SET name = ?, room_number = ?, building = ?, floor = ?, capacity = ?, equipment = ?, description = ?
       WHERE id = ?`,
      [
        input.name,
        input.room_number,
        input.building,
        input.floor,
        input.capacity,
        JSON.stringify(input.equipment),
        input.description,
        roomId,
      ],
    )
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

    if (status === 'inactive') {
      const [futureRows] = await conn.query(
        `SELECT title, starts_at FROM conference_sessions
         WHERE room_id = ? AND status = 'published' AND starts_at > NOW(3)
         ORDER BY starts_at`,
        [roomId],
      )
      const future = futureRows as Array<{ title: string; starts_at: string }>
      if (future.length > 0) {
        const list = future.map((s) => `"${s.title}" (${new Date(s.starts_at).toISOString()})`).join(', ')
        throw new BadRequestError(`This room has published future sessions and cannot be deactivated: ${list}.`)
      }
    }

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

// -----------------------------------------------------------------------
// Schedule slots (optional per-day helpers)
// -----------------------------------------------------------------------

export type ScheduleSlotRow = { id: string; label: string; starts_at: string; ends_at: string }

export async function listScheduleSlots(conferenceId: string): Promise<ScheduleSlotRow[]> {
  const [rows] = await pool.query(
    `SELECT id, label, starts_at, ends_at FROM schedule_slots WHERE conference_id = ? ORDER BY starts_at`,
    [conferenceId],
  )
  return rows as ScheduleSlotRow[]
}

export async function createScheduleSlot(
  actorUserId: string,
  conferenceId: string,
  input: ScheduleSlotInput,
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await conn.query(`INSERT INTO schedule_slots (conference_id, label, starts_at, ends_at) VALUES (?, ?, ?, ?)`, [
      conferenceId,
      input.label,
      new Date(input.starts_at),
      new Date(input.ends_at),
    ])
    const [rows] = await conn.query(
      `SELECT id FROM schedule_slots WHERE conference_id = ? ORDER BY created_at DESC LIMIT 1`,
      [conferenceId],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create the slot.')
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'schedule_slot.create',
      entityType: 'schedule_slots',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function loadScheduleSlot(conn: PoolConnection, conferenceId: string, slotId: string): Promise<ScheduleSlotRow> {
  const [rows] = await conn.query(
    `SELECT id, label, starts_at, ends_at FROM schedule_slots WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [slotId, conferenceId],
  )
  const row = (rows as ScheduleSlotRow[])[0]
  if (!row) throw new NotFoundError('This time slot does not exist.')
  return row
}

export async function updateScheduleSlot(
  actorUserId: string,
  conferenceId: string,
  slotId: string,
  input: ScheduleSlotInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadScheduleSlot(conn, conferenceId, slotId)
    await conn.query('UPDATE schedule_slots SET label = ?, starts_at = ?, ends_at = ? WHERE id = ?', [
      input.label,
      new Date(input.starts_at),
      new Date(input.ends_at),
      slotId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'schedule_slot.update',
      entityType: 'schedule_slots',
      entityId: slotId,
      oldValues: current,
      newValues: input,
    })
  })
}

export async function deleteScheduleSlot(actorUserId: string, conferenceId: string, slotId: string): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadScheduleSlot(conn, conferenceId, slotId)
    await conn.query('DELETE FROM schedule_slots WHERE id = ?', [slotId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'schedule_slot.delete',
      entityType: 'schedule_slots',
      entityId: slotId,
      oldValues: current,
    })
  })
}

/** Duplicates every slot that starts on `from_date` to the same wall-clock time on `to_date` (conference's own timezone). */
export async function copyScheduleDay(
  actorUserId: string,
  conferenceId: string,
  input: CopyDayInput,
): Promise<{ created: number }> {
  return withTransaction(actorUserId, async (conn) => {
    const [confRows] = await conn.query('SELECT timezone FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [
      conferenceId,
    ])
    const conference = (confRows as Array<{ timezone: string }>)[0]
    if (!conference) throw new NotFoundError('This conference does not exist.')

    const { startUtc: dayStart, endUtc: dayEnd } = localDateRangeToUtc(input.from_date, input.from_date, conference.timezone)
    const [slotRows] = await conn.query(
      `SELECT label, starts_at, ends_at FROM schedule_slots
       WHERE conference_id = ? AND starts_at >= ? AND starts_at <= ? ORDER BY starts_at`,
      [conferenceId, dayStart, dayEnd],
    )
    const slots = slotRows as Array<{ label: string; starts_at: string; ends_at: string }>
    if (slots.length === 0) return { created: 0 }

    const dayOffsetMs =
      new Date(`${input.to_date}T00:00:00Z`).getTime() - new Date(`${input.from_date}T00:00:00Z`).getTime()

    for (const slot of slots) {
      const newStart = new Date(new Date(slot.starts_at).getTime() + dayOffsetMs)
      const newEnd = new Date(new Date(slot.ends_at).getTime() + dayOffsetMs)
      await conn.query(`INSERT INTO schedule_slots (conference_id, label, starts_at, ends_at) VALUES (?, ?, ?, ?)`, [
        conferenceId,
        slot.label,
        newStart,
        newEnd,
      ])
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'schedule_slot.copy_day',
      entityType: 'schedule_slots',
      newValues: { from_date: input.from_date, to_date: input.to_date, count: slots.length },
    })
    return { created: slots.length }
  })
}

// -----------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------

export type SessionRow = {
  id: string
  title: string
  session_type: string
  description: string | null
  track_id: string | null
  room_id: string
  slot_id: string | null
  starts_at: string
  ends_at: string
  status: string
}

export type ChairRow = { user_id: string; full_name: string; chair_role: 'chair' | 'co_chair' }

export async function listSessions(conferenceId: string): Promise<SessionRow[]> {
  const [rows] = await pool.query(
    `SELECT id, title, session_type, description, track_id, room_id, slot_id, starts_at, ends_at, status
     FROM conference_sessions WHERE conference_id = ? ORDER BY starts_at`,
    [conferenceId],
  )
  return rows as SessionRow[]
}

export async function listChairsForSessions(sessionIds: string[]): Promise<Map<string, ChairRow[]>> {
  const map = new Map<string, ChairRow[]>()
  if (sessionIds.length === 0) return map
  const [rows] = await pool.query(
    `SELECT c.session_id, c.user_id, c.chair_role, u.full_name
     FROM session_chairs c JOIN users u ON u.id = c.user_id
     WHERE c.session_id IN (?)`,
    [sessionIds],
  )
  for (const row of rows as Array<{ session_id: string } & ChairRow>) {
    const list = map.get(row.session_id) ?? []
    list.push({ user_id: row.user_id, full_name: row.full_name, chair_role: row.chair_role })
    map.set(row.session_id, list)
  }
  return map
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
      `INSERT INTO conference_sessions (conference_id, room_id, track_id, slot_id, title, session_type, description, starts_at, ends_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conferenceId,
        input.room_id,
        input.track_id,
        input.slot_id ?? null,
        input.title,
        input.session_type,
        input.description,
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
    `SELECT id, title, session_type, description, track_id, room_id, slot_id, starts_at, ends_at, status
     FROM conference_sessions WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [sessionId, conferenceId],
  )
  const row = (rows as SessionRow[])[0]
  if (!row) throw new NotFoundError('This session does not exist.')
  return row
}

/** Chairs + presenting authors whose session time/room is about to change, so they can be notified after the update lands. */
async function loadScheduleChangeRecipients(
  conn: PoolConnection,
  sessionId: string,
): Promise<Array<{ user_id: string; full_name: string; email: string }>> {
  const [rows] = await conn.query(
    `SELECT DISTINCT u.id AS user_id, u.full_name, u.email
     FROM session_chairs c JOIN users u ON u.id = c.user_id
     WHERE c.session_id = ?
     UNION
     SELECT DISTINCT u.id AS user_id, u.full_name, u.email
     FROM presentations p JOIN users u ON u.id = p.presenter_user_id
     WHERE p.session_id = ? AND p.status <> 'cancelled'`,
    [sessionId, sessionId],
  )
  return rows as Array<{ user_id: string; full_name: string; email: string }>
}

async function notifyScheduleChange(
  conn: PoolConnection,
  conferenceId: string,
  sessionTitle: string,
  roomName: string,
  startsAt: Date,
  recipients: Array<{ user_id: string; full_name: string; email: string }>,
): Promise<void> {
  if (recipients.length === 0) return
  const [confRows] = await conn.query('SELECT code FROM conferences WHERE id = ? LIMIT 1', [conferenceId])
  const conferenceCode = (confRows as Array<{ code: string }>)[0]?.code ?? ''
  const [templateRows] = await conn.query(
    `SELECT subject, body_html FROM email_templates WHERE conference_id IS NULL AND template_key = 'schedule_changed' LIMIT 1`,
  )
  const template = (templateRows as Array<{ subject: string }>)[0]

  for (const recipient of recipients) {
    const data = {
      full_name: recipient.full_name,
      title: sessionTitle,
      starts_at: startsAt.toISOString(),
      room_name: roomName,
      conference_code: conferenceCode,
    }
    const subject = template ? renderTemplate(template.subject, data) : `Schedule change: ${sessionTitle}`
    await queueEmail(conn, {
      userId: recipient.user_id,
      conferenceId,
      recipientEmail: recipient.email,
      templateKey: 'schedule_changed',
      subject,
      templateData: data,
    })
    await notifyUser(conn, {
      userId: recipient.user_id,
      conferenceId,
      type: 'schedule',
      title: 'Schedule change',
      body: `"${sessionTitle}" has moved to ${startsAt.toISOString()} in ${roomName}.`,
    })
  }
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

    const timeOrRoomChanged =
      current.room_id !== input.room_id ||
      new Date(current.starts_at).getTime() !== new Date(input.starts_at).getTime() ||
      new Date(current.ends_at).getTime() !== new Date(input.ends_at).getTime()
    const wasPublished = current.status === 'published'

    await conn.query(
      `UPDATE conference_sessions
       SET room_id = ?, track_id = ?, slot_id = ?, title = ?, session_type = ?, description = ?, starts_at = ?, ends_at = ?, status = ?
       WHERE id = ?`,
      [
        input.room_id,
        input.track_id,
        input.slot_id ?? null,
        input.title,
        input.session_type,
        input.description,
        new Date(input.starts_at),
        new Date(input.ends_at),
        input.status,
        sessionId,
      ],
    )

    if (wasPublished && timeOrRoomChanged) {
      const [roomRows] = await conn.query('SELECT name FROM rooms WHERE id = ? LIMIT 1', [input.room_id])
      const roomName = (roomRows as Array<{ name: string }>)[0]?.name ?? ''
      const recipients = await loadScheduleChangeRecipients(conn, sessionId)
      await notifyScheduleChange(conn, conferenceId, input.title, roomName, new Date(input.starts_at), recipients)
    }

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

// -----------------------------------------------------------------------
// Session chairs
// -----------------------------------------------------------------------

/** Active members holding the session_chair role — candidates for the chair picker. */
export async function listChairCandidates(conferenceId: string): Promise<Array<{ user_id: string; full_name: string }>> {
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id AS user_id, u.full_name
     FROM conference_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.conference_id = ? AND cm.status = 'active' AND cm.role_code = 'session_chair'
     ORDER BY u.full_name`,
    [conferenceId],
  )
  return rows as Array<{ user_id: string; full_name: string }>
}

export async function assignSessionChair(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  input: SessionChairInput,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const session = await loadSession(conn, conferenceId, sessionId)

    const [memberRows] = await conn.query(
      `SELECT 1 FROM conference_members WHERE conference_id = ? AND user_id = ? AND status = 'active' AND role_code = 'session_chair' LIMIT 1`,
      [conferenceId, input.user_id],
    )
    if ((memberRows as unknown[]).length === 0) {
      throw new BadRequestError('This person does not hold the session chair role for this conference yet.')
    }

    await conn.query(`INSERT INTO session_chairs (session_id, user_id, chair_role) VALUES (?, ?, ?)`, [
      sessionId,
      input.user_id,
      input.chair_role,
    ])

    const [userRows] = await conn.query('SELECT full_name, email FROM users WHERE id = ? LIMIT 1', [input.user_id])
    const user = (userRows as Array<{ full_name: string; email: string }>)[0]
    const [roomRows] = await conn.query('SELECT name FROM rooms WHERE id = ? LIMIT 1', [session.room_id])
    const roomName = (roomRows as Array<{ name: string }>)[0]?.name ?? ''
    if (user) {
      await notifyScheduleChange(conn, conferenceId, session.title, roomName, new Date(session.starts_at), [
        { user_id: input.user_id, full_name: user.full_name, email: user.email },
      ])
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'session.assign_chair',
      entityType: 'session_chairs',
      entityId: sessionId,
      newValues: input,
    })
  })
}

export async function removeSessionChair(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  userId: string,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    await loadSession(conn, conferenceId, sessionId)
    const [result] = await conn.query('DELETE FROM session_chairs WHERE session_id = ? AND user_id = ?', [
      sessionId,
      userId,
    ])
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new NotFoundError('This person is not a chair of this session.')
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'session.remove_chair',
      entityType: 'session_chairs',
      entityId: sessionId,
      oldValues: { user_id: userId },
    })
  })
}

/** True if `userId` can manage attendance (mark presented/absent) for this session: schedule.manage, or listed as one of its chairs. */
export async function canManageSessionAttendance(userId: string, conferenceId: string, sessionId: string): Promise<boolean> {
  if (await isPlatformAdmin(userId)) return true
  const permissions = await getConferencePermissions(userId, conferenceId)
  if (permissions.has('schedule.manage')) return true
  const [rows] = await pool.query('SELECT 1 FROM session_chairs WHERE session_id = ? AND user_id = ? LIMIT 1', [
    sessionId,
    userId,
  ])
  return (rows as unknown[]).length > 0
}

export async function assertCanManageSessionAttendance(
  userId: string,
  conferenceId: string,
  sessionId: string,
): Promise<void> {
  if (!(await canManageSessionAttendance(userId, conferenceId, sessionId))) {
    throw new ForbiddenError('You do not have permission to do this.')
  }
}

/** Every session a chair/co-chair is assigned to, across all their conferences — their "My sessions" list. */
export async function listMyChairSessions(userId: string): Promise<
  Array<{ conference_id: string; conference_name: string; session_id: string; title: string; room_name: string; starts_at: string; ends_at: string }>
> {
  const [rows] = await pool.query(
    `SELECT s.conference_id, co.name AS conference_name, s.id AS session_id, s.title, r.name AS room_name, s.starts_at, s.ends_at
     FROM session_chairs c
     JOIN conference_sessions s ON s.id = c.session_id
     JOIN conferences co ON co.id = s.conference_id
     JOIN rooms r ON r.id = s.room_id
     WHERE c.user_id = ? AND s.status <> 'cancelled'
     ORDER BY s.starts_at`,
    [userId],
  )
  return rows as Array<{
    conference_id: string
    conference_name: string
    session_id: string
    title: string
    room_name: string
    starts_at: string
    ends_at: string
  }>
}

// -----------------------------------------------------------------------
// Presentations
// -----------------------------------------------------------------------

export type PresentationRow = {
  id: string
  session_id: string
  submission_id: string | null
  speaker_id: string | null
  title: string | null
  presenter_user_id: string | null
  starts_at: string
  ends_at: string
  presentation_order: number
  status: string
}

export async function listPresentationsForSessions(sessionIds: string[]): Promise<Map<string, PresentationRow[]>> {
  const map = new Map<string, PresentationRow[]>()
  if (sessionIds.length === 0) return map
  const [rows] = await pool.query(
    `SELECT id, session_id, submission_id, speaker_id, title, presenter_user_id, starts_at, ends_at, presentation_order, status
     FROM presentations WHERE session_id IN (?) AND status <> 'cancelled' ORDER BY session_id, presentation_order`,
    [sessionIds],
  )
  for (const row of rows as PresentationRow[]) {
    const list = map.get(row.session_id) ?? []
    list.push(row)
    map.set(row.session_id, list)
  }
  return map
}

export type SchedulableSubmissionRow = {
  id: string
  submission_code: string | null
  title: string
  status: string
  track_id: string
}

const SCHEDULABLE_STATUSES = ['accepted', 'full_paper_pending', 'full_paper_submitted', 'final_approved'] as const

export async function listSchedulableSubmissions(
  conferenceId: string,
  trackId?: string,
): Promise<SchedulableSubmissionRow[]> {
  const conditions = ['s.conference_id = ?', 's.deleted_at IS NULL', `s.status IN (?)`]
  const params: unknown[] = [conferenceId, SCHEDULABLE_STATUSES]
  if (trackId) {
    conditions.push('s.track_id = ?')
    params.push(trackId)
  }
  const [rows] = await pool.query(
    `SELECT s.id, s.submission_code, s.title, s.status, s.track_id
     FROM submissions s
     WHERE ${conditions.join(' AND ')}
       AND NOT EXISTS (SELECT 1 FROM presentations p WHERE p.submission_id = s.id AND p.status <> 'cancelled')
     ORDER BY s.title`,
    params,
  )
  return rows as SchedulableSubmissionRow[]
}

async function nextPresentationSlot(
  conn: PoolConnection,
  sessionId: string,
): Promise<{ order: number; startsAt: Date }> {
  const [rows] = await conn.query(
    `SELECT presentation_order, ends_at FROM presentations
     WHERE session_id = ? AND status <> 'cancelled' ORDER BY presentation_order DESC LIMIT 1`,
    [sessionId],
  )
  const last = (rows as Array<{ presentation_order: number; ends_at: string }>)[0]
  if (last) return { order: last.presentation_order + 1, startsAt: new Date(last.ends_at) }

  const [sessionRows] = await conn.query('SELECT starts_at FROM conference_sessions WHERE id = ? LIMIT 1', [sessionId])
  const session = (sessionRows as Array<{ starts_at: string }>)[0]
  return { order: 1, startsAt: new Date(session?.starts_at ?? Date.now()) }
}

/** The submission's corresponding author (used as the presenter for overlap checks and the "scheduled" notification). */
async function correspondingAuthor(
  conn: PoolConnection,
  submissionId: string,
): Promise<{ user_id: string | null; full_name: string; email: string } | null> {
  const [rows] = await conn.query(
    `SELECT user_id, full_name, email FROM submission_authors WHERE submission_id = ? AND is_corresponding = TRUE LIMIT 1`,
    [submissionId],
  )
  return (rows as Array<{ user_id: string | null; full_name: string; email: string }>)[0] ?? null
}

async function notifyPresentingAuthor(
  conn: PoolConnection,
  conferenceId: string,
  author: { user_id: string | null; full_name: string; email: string },
  title: string,
  roomName: string,
  startsAt: Date,
): Promise<void> {
  const [confRows] = await conn.query('SELECT code FROM conferences WHERE id = ? LIMIT 1', [conferenceId])
  const conferenceCode = (confRows as Array<{ code: string }>)[0]?.code ?? ''
  const [templateRows] = await conn.query(
    `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'presentation_scheduled' LIMIT 1`,
  )
  const template = (templateRows as Array<{ subject: string }>)[0]
  const data = { full_name: author.full_name, title, starts_at: startsAt.toISOString(), room_name: roomName, conference_code: conferenceCode }
  const subject = template ? renderTemplate(template.subject, data) : `Your presentation schedule: ${title}`

  await queueEmail(conn, {
    userId: author.user_id,
    conferenceId,
    recipientEmail: author.email,
    templateKey: 'presentation_scheduled',
    subject,
    templateData: data,
  })
  if (author.user_id) {
    await notifyUser(conn, {
      userId: author.user_id,
      conferenceId,
      type: 'schedule',
      title: 'Your presentation is scheduled',
      body: `"${title}" is scheduled for ${startsAt.toISOString()} in ${roomName}.`,
    })
  }
}

export async function addPaperPresentation(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  input: AddPaperPresentationInput,
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    const session = await loadSession(conn, conferenceId, sessionId)

    const [subRows] = await conn.query(
      `SELECT id, title, status FROM submissions WHERE id = ? AND conference_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [input.submission_id, conferenceId],
    )
    const submission = (subRows as Array<{ id: string; title: string; status: string }>)[0]
    if (!submission) throw new NotFoundError('This paper does not exist.')
    if (!(SCHEDULABLE_STATUSES as readonly string[]).includes(submission.status)) {
      throw new BadRequestError('This paper is not accepted yet, or has already been scheduled.')
    }

    const author = await correspondingAuthor(conn, input.submission_id)
    const { order, startsAt } = await nextPresentationSlot(conn, sessionId)
    const endsAt = new Date(startsAt.getTime() + input.duration_minutes * 60000)

    await conn.query(
      `INSERT INTO presentations (conference_id, session_id, submission_id, presenter_user_id, starts_at, ends_at, presentation_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [conferenceId, sessionId, input.submission_id, author?.user_id ?? null, startsAt, endsAt, order],
    )
    const [rows] = await conn.query(
      `SELECT id FROM presentations WHERE session_id = ? AND submission_id = ? ORDER BY created_at DESC LIMIT 1`,
      [sessionId, input.submission_id],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not schedule this paper.')

    await conn.query('SET @app_reason = ?', [`Scheduled into session: ${session.title}`])
    try {
      await conn.query(`UPDATE submissions SET status = 'scheduled' WHERE id = ?`, [input.submission_id])
    } catch (err) {
      mapDatabaseError(err)
    }

    const [roomRows] = await conn.query('SELECT name FROM rooms WHERE id = ? LIMIT 1', [session.room_id])
    const roomName = (roomRows as Array<{ name: string }>)[0]?.name ?? ''
    if (author) {
      await notifyPresentingAuthor(conn, conferenceId, author, submission.title, roomName, startsAt)
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'presentation.add_paper',
      entityType: 'presentations',
      entityId: id,
      newValues: { submission_id: input.submission_id, session_id: sessionId },
    })
    return { id }
  })
}

export async function addSpeakerPresentation(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  input: AddSpeakerPresentationInput,
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await loadSession(conn, conferenceId, sessionId)

    const [speakerRows] = await conn.query(
      `SELECT id, user_id FROM conference_speakers WHERE id = ? AND conference_id = ? LIMIT 1`,
      [input.speaker_id, conferenceId],
    )
    const speaker = (speakerRows as Array<{ id: string; user_id: string | null }>)[0]
    if (!speaker) throw new NotFoundError('This speaker does not exist.')

    const { order, startsAt } = await nextPresentationSlot(conn, sessionId)
    const endsAt = new Date(startsAt.getTime() + input.duration_minutes * 60000)

    await conn.query(
      `INSERT INTO presentations (conference_id, session_id, speaker_id, title, presenter_user_id, starts_at, ends_at, presentation_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [conferenceId, sessionId, input.speaker_id, input.title, speaker.user_id, startsAt, endsAt, order],
    )
    const [rows] = await conn.query(
      `SELECT id FROM presentations WHERE session_id = ? AND speaker_id = ? ORDER BY created_at DESC LIMIT 1`,
      [sessionId, input.speaker_id],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not schedule this talk.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'presentation.add_speaker',
      entityType: 'presentations',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function loadPresentation(conn: PoolConnection, conferenceId: string, presentationId: string) {
  const [rows] = await conn.query(
    `SELECT id, session_id, submission_id, speaker_id, title, presenter_user_id, starts_at, ends_at, presentation_order, status
     FROM presentations WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
    [presentationId, conferenceId],
  )
  const row = (rows as PresentationRow[])[0]
  if (!row) throw new NotFoundError('This presentation does not exist.')
  return row
}

/** Figures out which status a scheduled submission should fall back to — whatever it was immediately before 'scheduled'. */
async function statusBeforeScheduled(conn: PoolConnection, submissionId: string): Promise<'accepted' | 'final_approved'> {
  const [rows] = await conn.query(
    `SELECT from_status FROM submission_status_history
     WHERE submission_id = ? AND to_status = 'scheduled' ORDER BY changed_at DESC LIMIT 1`,
    [submissionId],
  )
  const from = (rows as Array<{ from_status: string | null }>)[0]?.from_status
  return from === 'final_approved' ? 'final_approved' : 'accepted'
}

export async function removePresentation(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  presentationId: string,
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadPresentation(conn, conferenceId, presentationId)
    if (current.session_id !== sessionId) throw new NotFoundError('This presentation does not exist.')

    await conn.query(`UPDATE presentations SET status = 'cancelled' WHERE id = ?`, [presentationId])

    if (current.submission_id) {
      const [subRows] = await conn.query('SELECT status FROM submissions WHERE id = ? LIMIT 1', [current.submission_id])
      const submission = (subRows as Array<{ status: string }>)[0]
      if (submission?.status === 'scheduled') {
        const revertTo = await statusBeforeScheduled(conn, current.submission_id)
        await conn.query('SET @app_reason = ?', ['Removed from the programme'])
        try {
          await conn.query('UPDATE submissions SET status = ? WHERE id = ?', [revertTo, current.submission_id])
        } catch (err) {
          mapDatabaseError(err)
        }
      }
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'presentation.remove',
      entityType: 'presentations',
      entityId: presentationId,
      oldValues: current,
    })
  })
}

/** Re-numbers presentation_order 1..N in the given order, then repacks times back-to-back from the session start. */
export async function reorderPresentations(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  presentationIds: string[],
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const session = await loadSession(conn, conferenceId, sessionId)
    const [rows] = await conn.query(
      `SELECT id, starts_at, ends_at, status FROM presentations WHERE session_id = ? AND status <> 'cancelled' FOR UPDATE`,
      [sessionId],
    )
    const existing = rows as Array<{ id: string; starts_at: string; ends_at: string; status: string }>
    const byId = new Map(existing.map((p) => [p.id, p]))
    if (presentationIds.length !== existing.length || !presentationIds.every((id) => byId.has(id))) {
      throw new BadRequestError('The list of presentations does not match this session.')
    }

    // The overlap trigger ignores cancelled rows (and the unique order index
    // treats a cancelled row's order as NULL via active_flag), so temporarily
    // cancelling every row first is what lets the next loop freely reassign
    // order/times one at a time without ever colliding with a sibling that
    // hasn't been moved yet — then each row is restored to its real status
    // right as it's placed in its final slot.
    for (const id of presentationIds) {
      await conn.query(`UPDATE presentations SET status = 'cancelled' WHERE id = ?`, [id])
    }

    let cursor = new Date(session.starts_at)
    let i = 0
    for (const id of presentationIds) {
      i += 1
      const original = byId.get(id)!
      const durationMs = new Date(original.ends_at).getTime() - new Date(original.starts_at).getTime()
      const starts = new Date(cursor)
      const ends = new Date(cursor.getTime() + durationMs)
      await conn.query(
        'UPDATE presentations SET presentation_order = ?, starts_at = ?, ends_at = ?, status = ? WHERE id = ?',
        [i, starts, ends, original.status, id],
      )
      cursor = ends
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'presentation.reorder',
      entityType: 'conference_sessions',
      entityId: sessionId,
      newValues: { presentation_ids: presentationIds },
    })
  })
}

export async function markPresentation(
  actorUserId: string,
  conferenceId: string,
  presentationId: string,
  status: 'presented' | 'absent',
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadPresentation(conn, conferenceId, presentationId)
    await conn.query('UPDATE presentations SET status = ?, marked_by = ?, marked_at = NOW(3) WHERE id = ?', [
      status,
      actorUserId,
      presentationId,
    ])

    if (status === 'presented' && current.submission_id) {
      const [subRows] = await conn.query('SELECT status FROM submissions WHERE id = ? LIMIT 1', [current.submission_id])
      const submission = (subRows as Array<{ status: string }>)[0]
      if (submission?.status === 'scheduled') {
        await conn.query('SET @app_reason = ?', ['Marked presented'])
        try {
          await conn.query(`UPDATE submissions SET status = 'presented' WHERE id = ?`, [current.submission_id])
        } catch (err) {
          mapDatabaseError(err)
        }
      }
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'presentation.mark',
      entityType: 'presentations',
      entityId: presentationId,
      oldValues: { status: current.status },
      newValues: { status },
    })
  })
}

// -----------------------------------------------------------------------
// Public / convenor combined views
// -----------------------------------------------------------------------

export type PublicPresentationRow = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  presentation_order: number
  submission_code: string | null
  authors: string[] | null
  speaker_name: string | null
}

export type PublicSessionRow = {
  id: string
  title: string
  session_type: string
  description: string | null
  starts_at: string
  ends_at: string
  status: string
  room: { id: string; name: string; room_number: string | null; building: string | null } | null
  track: { id: string; name: string } | null
  chairs: ChairRow[]
  presentations: PublicPresentationRow[]
}

async function assembleSessions(sessionFilter: string, params: unknown[]): Promise<PublicSessionRow[]> {
  const [sessionRows] = await pool.query(
    `SELECT s.id, s.title, s.session_type, s.description, s.starts_at, s.ends_at, s.status,
            r.id AS room_id, r.name AS room_name, r.room_number, r.building,
            t.id AS track_id, t.name AS track_name
     FROM conference_sessions s
     JOIN rooms r ON r.id = s.room_id
     LEFT JOIN conference_tracks t ON t.id = s.track_id
     WHERE ${sessionFilter}
     ORDER BY s.starts_at`,
    params,
  )
  const sessions = sessionRows as Array<{
    id: string
    title: string
    session_type: string
    description: string | null
    starts_at: string
    ends_at: string
    status: string
    room_id: string
    room_name: string
    room_number: string | null
    building: string | null
    track_id: string | null
    track_name: string | null
  }>
  if (sessions.length === 0) return []

  const sessionIds = sessions.map((s) => s.id)
  const chairsBySession = await listChairsForSessions(sessionIds)
  const presentationsBySession = await listPresentationsForSessions(sessionIds)

  const submissionIds = [...presentationsBySession.values()].flat().map((p) => p.submission_id).filter((id): id is string => Boolean(id))
  const authorsBySubmission = new Map<string, string[]>()
  if (submissionIds.length > 0) {
    const [authorRows] = await pool.query(
      `SELECT submission_id, full_name FROM submission_authors WHERE submission_id IN (?) ORDER BY submission_id, author_order`,
      [submissionIds],
    )
    for (const row of authorRows as Array<{ submission_id: string; full_name: string }>) {
      const list = authorsBySubmission.get(row.submission_id) ?? []
      list.push(row.full_name)
      authorsBySubmission.set(row.submission_id, list)
    }
  }

  const submissionTitles = new Map<string, { title: string; submission_code: string | null }>()
  if (submissionIds.length > 0) {
    const [subRows] = await pool.query(`SELECT id, title, submission_code FROM submissions WHERE id IN (?)`, [
      submissionIds,
    ])
    for (const row of subRows as Array<{ id: string; title: string; submission_code: string | null }>) {
      submissionTitles.set(row.id, { title: row.title, submission_code: row.submission_code })
    }
  }

  const speakerIds = [...presentationsBySession.values()].flat().map((p) => p.speaker_id).filter((id): id is string => Boolean(id))
  const speakerNames = new Map<string, string>()
  if (speakerIds.length > 0) {
    const [speakerRows] = await pool.query(`SELECT id, full_name FROM conference_speakers WHERE id IN (?)`, [speakerIds])
    for (const row of speakerRows as Array<{ id: string; full_name: string }>) {
      speakerNames.set(row.id, row.full_name)
    }
  }

  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    session_type: s.session_type,
    description: s.description,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    status: s.status,
    room: { id: s.room_id, name: s.room_name, room_number: s.room_number, building: s.building },
    track: s.track_id ? { id: s.track_id, name: s.track_name! } : null,
    chairs: chairsBySession.get(s.id) ?? [],
    presentations: (presentationsBySession.get(s.id) ?? []).map((p) => ({
      id: p.id,
      title: p.submission_id ? submissionTitles.get(p.submission_id)?.title ?? '' : p.title ?? '',
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      presentation_order: p.presentation_order,
      submission_code: p.submission_id ? submissionTitles.get(p.submission_id)?.submission_code ?? null : null,
      authors: p.submission_id ? authorsBySubmission.get(p.submission_id) ?? [] : null,
      speaker_name: p.speaker_id ? speakerNames.get(p.speaker_id) ?? null : null,
    })),
  }))
}

export async function getPublicSchedule(conferenceId: string): Promise<PublicSessionRow[]> {
  return assembleSessions(`s.conference_id = ? AND s.status = 'published'`, [conferenceId])
}

export async function getConvenorSchedule(conferenceId: string): Promise<PublicSessionRow[]> {
  return assembleSessions(`s.conference_id = ? AND s.status <> 'cancelled'`, [conferenceId])
}

/** One session with its room/track/chairs/presentations — used by both the convenor editor and the session-chair attendance view. */
export async function getSessionDetail(conferenceId: string, sessionId: string): Promise<PublicSessionRow | null> {
  const rows = await assembleSessions('s.id = ? AND s.conference_id = ?', [sessionId, conferenceId])
  return rows[0] ?? null
}

export type ScheduleWarnings = {
  unscheduled_papers: Array<{ id: string; title: string; submission_code: string | null }>
  sessions_without_chair: Array<{ id: string; title: string; starts_at: string }>
}

export async function getScheduleWarnings(conferenceId: string): Promise<ScheduleWarnings> {
  const [unscheduledRows] = await pool.query(
    `SELECT id, title, submission_code FROM submissions
     WHERE conference_id = ? AND deleted_at IS NULL AND status IN (?)
       AND NOT EXISTS (SELECT 1 FROM presentations p WHERE p.submission_id = submissions.id AND p.status <> 'cancelled')
     ORDER BY title`,
    [conferenceId, SCHEDULABLE_STATUSES],
  )
  const [noChairRows] = await pool.query(
    `SELECT s.id, s.title, s.starts_at FROM conference_sessions s
     WHERE s.conference_id = ? AND s.status = 'published' AND s.session_type NOT IN ('break')
       AND NOT EXISTS (SELECT 1 FROM session_chairs c WHERE c.session_id = s.id)
     ORDER BY s.starts_at`,
    [conferenceId],
  )
  return {
    unscheduled_papers: unscheduledRows as ScheduleWarnings['unscheduled_papers'],
    sessions_without_chair: noChairRows as ScheduleWarnings['sessions_without_chair'],
  }
}

/** Where and when a given user is presenting at this conference — for their own "My presentation" view. */
export async function getMyPresentations(
  conferenceId: string,
  userId: string,
): Promise<Array<{ session_title: string; room_name: string; starts_at: string; ends_at: string; title: string }>> {
  const [rows] = await pool.query(
    `SELECT s.title AS session_title, r.name AS room_name, p.starts_at, p.ends_at,
            COALESCE(sub.title, p.title) AS title
     FROM presentations p
     JOIN conference_sessions s ON s.id = p.session_id
     JOIN rooms r ON r.id = s.room_id
     LEFT JOIN submissions sub ON sub.id = p.submission_id
     WHERE p.conference_id = ? AND p.presenter_user_id = ? AND p.status <> 'cancelled' AND s.status = 'published'
     ORDER BY p.starts_at`,
    [conferenceId, userId],
  )
  return rows as Array<{ session_title: string; room_name: string; starts_at: string; ends_at: string; title: string }>
}
