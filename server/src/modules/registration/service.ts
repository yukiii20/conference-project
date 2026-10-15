import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { generateUrlSafeToken } from '../../utils/crypto.js'
import { localDateKey } from '../../utils/timezone.js'
import { notifyUser } from '../../utils/notifications.js'
import { canManageSessionAttendance } from '../schedule/service.js'
import { isWindowOpen, loadDeadlineWindow } from '../submissions/service.js'
import { assertConferencePermission } from '../../middleware/auth.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js'
import type { RegistrationCategoryInput } from './validation.js'

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ER_DUP_ENTRY')
}

// -----------------------------------------------------------------------
// Registration categories
// -----------------------------------------------------------------------

export type CategoryRow = {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  display_order: number
}

/** Auto-creates a single "general" category the first time anyone looks to register, if the conference has none yet. */
async function ensureAtLeastOneCategory(conn: PoolConnection, conferenceId: string): Promise<void> {
  const [rows] = await conn.query('SELECT 1 FROM registration_categories WHERE conference_id = ? LIMIT 1', [
    conferenceId,
  ])
  if ((rows as unknown[]).length > 0) return
  await conn.query(
    `INSERT INTO registration_categories (conference_id, code, name, description, is_active, display_order)
     VALUES (?, 'general', 'General', NULL, TRUE, 0)`,
    [conferenceId],
  )
}

export async function listCategories(conferenceId: string): Promise<CategoryRow[]> {
  return withTransaction(null, async (conn) => {
    await ensureAtLeastOneCategory(conn, conferenceId)
    const [rows] = await conn.query(
      `SELECT id, code, name, description, is_active, display_order FROM registration_categories
       WHERE conference_id = ? ORDER BY display_order, name`,
      [conferenceId],
    )
    return rows as CategoryRow[]
  })
}

export async function createCategory(
  actorUserId: string,
  conferenceId: string,
  input: RegistrationCategoryInput,
  ctx: AuditContext = {},
): Promise<{ id: string }> {
  return withTransaction(actorUserId, async (conn) => {
    try {
      await conn.query(
        `INSERT INTO registration_categories (conference_id, code, name, description, is_active, display_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conferenceId, input.code, input.name, input.description ?? null, input.is_active, input.display_order],
      )
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new BadRequestError('A category with this code already exists.')
      }
      throw err
    }
    const [rows] = await conn.query(
      'SELECT id FROM registration_categories WHERE conference_id = ? AND code = ? LIMIT 1',
      [conferenceId, input.code],
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create this category.')

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'registration_category.create',
      entityType: 'registration_categories',
      entityId: id,
      newValues: input,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return { id }
  })
}

export async function updateCategory(
  actorUserId: string,
  conferenceId: string,
  categoryId: string,
  input: RegistrationCategoryInput,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, code, name, description, is_active, display_order FROM registration_categories
       WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
      [categoryId, conferenceId],
    )
    const current = (rows as CategoryRow[])[0]
    if (!current) throw new NotFoundError('This category does not exist.')

    try {
      await conn.query(
        `UPDATE registration_categories SET code = ?, name = ?, description = ?, is_active = ?, display_order = ?
         WHERE id = ?`,
        [input.code, input.name, input.description ?? null, input.is_active, input.display_order, categoryId],
      )
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new BadRequestError('A category with this code already exists.')
      }
      throw err
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'registration_category.update',
      entityType: 'registration_categories',
      entityId: categoryId,
      oldValues: current,
      newValues: input,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

// -----------------------------------------------------------------------
// Registering to attend
// -----------------------------------------------------------------------

export type MyRegistrationRow = {
  id: string
  registration_number: string
  status: 'pending' | 'confirmed' | 'waitlisted' | 'cancelled'
  category_name: string
  amount_due: string
  currency: string
  registered_at: string
}

export async function getMyRegistration(conferenceId: string, userId: string): Promise<MyRegistrationRow | null> {
  const [rows] = await pool.query(
    `SELECT r.id, r.registration_number, r.status, r.amount_due, r.currency, r.registered_at, c.name AS category_name
     FROM registrations r JOIN registration_categories c ON c.id = r.category_id
     WHERE r.conference_id = ? AND r.user_id = ? AND r.status <> 'cancelled'
     ORDER BY r.registered_at DESC LIMIT 1`,
    [conferenceId, userId],
  )
  return (rows as MyRegistrationRow[])[0] ?? null
}

/** The raw qr_token, used only to build the QR image — never serialised into a JSON response. */
export async function getMyRegistrationQrToken(conferenceId: string, userId: string): Promise<string | null> {
  const [rows] = await pool.query(
    `SELECT qr_token FROM registrations WHERE conference_id = ? AND user_id = ? AND status <> 'cancelled'
     ORDER BY registered_at DESC LIMIT 1`,
    [conferenceId, userId],
  )
  return (rows as Array<{ qr_token: string }>)[0]?.qr_token ?? null
}

export async function register(
  conferenceId: string,
  userId: string,
  categoryId: string,
  ctx: AuditContext = {},
): Promise<{ id: string; registration_number: string; status: string }> {
  return withTransaction(userId, async (conn) => {
    const window = await loadDeadlineWindow(conferenceId, 'registration')
    if (!isWindowOpen(window)) {
      throw new ConflictError('Registration is not open right now.')
    }

    await ensureAtLeastOneCategory(conn, conferenceId)
    const [categoryRows] = await conn.query(
      `SELECT id FROM registration_categories WHERE id = ? AND conference_id = ? AND is_active = TRUE LIMIT 1`,
      [categoryId, conferenceId],
    )
    if ((categoryRows as unknown[]).length === 0) {
      throw new BadRequestError('Choose a valid, active registration category.')
    }

    const [confRows] = await conn.query(
      `SELECT co.code, cs.registration_requires_payment, cs.default_currency
       FROM conferences co JOIN conference_settings cs ON cs.conference_id = co.id
       WHERE co.id = ? AND co.deleted_at IS NULL LIMIT 1`,
      [conferenceId],
    )
    const conference = (confRows as Array<{ code: string; registration_requires_payment: number; default_currency: string }>)[0]
    if (!conference) throw new NotFoundError('This conference does not exist.')

    await conn.query(
      `INSERT INTO conference_counters (conference_id, counter_key, current_value) VALUES (?, 'registration', 0)
       ON DUPLICATE KEY UPDATE conference_id = conference_id`,
      [conferenceId],
    )
    const [counterRows] = await conn.query(
      `SELECT current_value FROM conference_counters WHERE conference_id = ? AND counter_key = 'registration' FOR UPDATE`,
      [conferenceId],
    )
    const next = ((counterRows as Array<{ current_value: number }>)[0]?.current_value ?? 0) + 1
    await conn.query(
      `UPDATE conference_counters SET current_value = ? WHERE conference_id = ? AND counter_key = 'registration'`,
      [next, conferenceId],
    )
    const registrationNumber = `${conference.code}-R${String(next).padStart(4, '0')}`
    const status = conference.registration_requires_payment ? 'pending' : 'confirmed'
    const qrToken = generateUrlSafeToken(48)

    try {
      await conn.query(
        `INSERT INTO registrations
           (conference_id, user_id, category_id, registration_number, status, amount_due, currency, qr_token, confirmed_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ${status === 'confirmed' ? 'NOW(3)' : 'NULL'})`,
        [conferenceId, userId, categoryId, registrationNumber, status, conference.default_currency, qrToken],
      )
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('You already have an active registration for this conference.')
      }
      throw err
    }

    const [idRows] = await conn.query('SELECT id FROM registrations WHERE registration_number = ? LIMIT 1', [
      registrationNumber,
    ])
    const id = (idRows as Array<{ id: string }>)[0]!.id

    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: 'registration.create',
      entityType: 'registrations',
      entityId: id,
      newValues: { category_id: categoryId, status },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return { id, registration_number: registrationNumber, status }
  })
}

export async function cancelMyRegistration(conferenceId: string, userId: string, ctx: AuditContext = {}): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, status FROM registrations WHERE conference_id = ? AND user_id = ? AND status <> 'cancelled'
       ORDER BY registered_at DESC LIMIT 1 FOR UPDATE`,
      [conferenceId, userId],
    )
    const current = (rows as Array<{ id: string; status: string }>)[0]
    if (!current) throw new NotFoundError('You do not have an active registration for this conference.')

    await conn.query(`UPDATE registrations SET status = 'cancelled', cancelled_at = NOW(3) WHERE id = ?`, [current.id])
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: 'registration.cancel',
      entityType: 'registrations',
      entityId: current.id,
      oldValues: { status: current.status },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

// -----------------------------------------------------------------------
// Convenor/manager: manage registrations
// -----------------------------------------------------------------------

export type AdminRegistrationRow = {
  id: string
  registration_number: string
  full_name: string
  email: string
  category_name: string
  status: string
  amount_due: string
  currency: string
  registered_at: string
}

// Deliberately selects every column except qr_token — it must never appear
// in a list response (only the owner's own QR-image endpoint reads it).
export async function listRegistrations(
  conferenceId: string,
  filter: { search?: string; status?: string } = {},
): Promise<AdminRegistrationRow[]> {
  const conditions = ['r.conference_id = ?']
  const params: unknown[] = [conferenceId]
  if (filter.status) {
    conditions.push('r.status = ?')
    params.push(filter.status)
  }
  if (filter.search) {
    conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR r.registration_number LIKE ?)')
    const like = `%${filter.search}%`
    params.push(like, like, like)
  }
  const [rows] = await pool.query(
    `SELECT r.id, r.registration_number, u.full_name, u.email, c.name AS category_name,
            r.status, r.amount_due, r.currency, r.registered_at
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     JOIN registration_categories c ON c.id = r.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.registered_at DESC`,
    params,
  )
  return rows as AdminRegistrationRow[]
}

export async function exportRegistrationsCsv(conferenceId: string): Promise<string> {
  const rows = await listRegistrations(conferenceId)
  const header = ['Registration number', 'Name', 'Email', 'Category', 'Status', 'Amount due', 'Currency', 'Registered at']
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [header.map(escape).join(',')]
  for (const r of rows) {
    lines.push(
      [r.registration_number, r.full_name, r.email, r.category_name, r.status, r.amount_due, r.currency, r.registered_at]
        .map((v) => escape(String(v)))
        .join(','),
    )
  }
  return lines.join('\r\n')
}

async function loadRegistrationForAdmin(conn: PoolConnection, conferenceId: string, registrationId: string) {
  const [rows] = await conn.query(
    `SELECT r.id, r.status, r.user_id, u.full_name, u.email
     FROM registrations r JOIN users u ON u.id = r.user_id
     WHERE r.id = ? AND r.conference_id = ? LIMIT 1 FOR UPDATE`,
    [registrationId, conferenceId],
  )
  const row = (rows as Array<{ id: string; status: string; user_id: string; full_name: string; email: string }>)[0]
  if (!row) throw new NotFoundError('This registration does not exist.')
  return row
}

export async function confirmRegistration(
  actorUserId: string,
  conferenceId: string,
  registrationId: string,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadRegistrationForAdmin(conn, conferenceId, registrationId)
    if (current.status !== 'pending') {
      throw new ConflictError('Only a pending registration can be confirmed.')
    }
    await conn.query(`UPDATE registrations SET status = 'confirmed', confirmed_at = NOW(3) WHERE id = ?`, [
      registrationId,
    ])
    await notifyUser(conn, {
      userId: current.user_id,
      conferenceId,
      type: 'payment',
      title: 'Your registration is confirmed',
      body: 'Your registration has been confirmed by the organisers.',
    })
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'registration.confirm',
      entityType: 'registrations',
      entityId: registrationId,
      oldValues: { status: current.status },
      newValues: { status: 'confirmed' },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export async function adminCancelRegistration(
  actorUserId: string,
  conferenceId: string,
  registrationId: string,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const current = await loadRegistrationForAdmin(conn, conferenceId, registrationId)
    if (current.status === 'cancelled') {
      throw new ConflictError('This registration is already cancelled.')
    }
    await conn.query(`UPDATE registrations SET status = 'cancelled', cancelled_at = NOW(3) WHERE id = ?`, [
      registrationId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'registration.admin_cancel',
      entityType: 'registrations',
      entityId: registrationId,
      oldValues: { status: current.status },
      newValues: { status: 'cancelled' },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

// -----------------------------------------------------------------------
// Attendance (conference check-in)
// -----------------------------------------------------------------------

export type SearchableRegistrationRow = {
  id: string
  registration_number: string
  full_name: string
  email: string
  category_name: string
  status: string
}

/** For the staff manual-search check-in box — never returns qr_token. */
export async function searchRegistrations(conferenceId: string, search: string): Promise<SearchableRegistrationRow[]> {
  const like = `%${search}%`
  const [rows] = await pool.query(
    `SELECT r.id, r.registration_number, u.full_name, u.email, c.name AS category_name, r.status
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     JOIN registration_categories c ON c.id = r.category_id
     WHERE r.conference_id = ? AND r.status <> 'cancelled'
       AND (u.full_name LIKE ? OR u.email LIKE ? OR r.registration_number LIKE ?)
     ORDER BY u.full_name LIMIT 20`,
    [conferenceId, like, like, like],
  )
  return rows as SearchableRegistrationRow[]
}

export type CheckinResult = { full_name: string; registration_number: string }

async function loadConferenceTimezone(conn: PoolConnection, conferenceId: string): Promise<string> {
  const [rows] = await conn.query('SELECT timezone FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [
    conferenceId,
  ])
  const timezone = (rows as Array<{ timezone: string }>)[0]?.timezone
  if (!timezone) throw new NotFoundError('This conference does not exist.')
  return timezone
}

async function performCheckin(
  actorUserId: string,
  conferenceId: string,
  registration: { id: string; conference_id: string; status: string; user_id: string; full_name: string; registration_number: string },
  method: 'qr' | 'manual',
  date: string | undefined,
  ctx: AuditContext,
): Promise<CheckinResult> {
  return withTransaction(actorUserId, async (conn) => {
    if (registration.conference_id !== conferenceId) {
      throw new BadRequestError('This registration is for a different conference.')
    }
    if (registration.status === 'cancelled') {
      throw new BadRequestError('This registration has been cancelled.')
    }
    if (registration.status !== 'confirmed') {
      throw new BadRequestError('This registration is not confirmed yet.')
    }

    const timezone = await loadConferenceTimezone(conn, conferenceId)
    const attendanceDate = date ?? localDateKey(timezone)

    try {
      await conn.query(
        `INSERT INTO conference_attendance (conference_id, registration_id, user_id, attendance_date, method, checked_in_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conferenceId, registration.id, registration.user_id, attendanceDate, method, actorUserId],
      )
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('Already checked in today.')
      }
      throw err
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'attendance.check_in',
      entityType: 'conference_attendance',
      entityId: registration.id,
      newValues: { attendance_date: attendanceDate, method },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return { full_name: registration.full_name, registration_number: registration.registration_number }
  })
}

export async function checkinByQrToken(
  actorUserId: string,
  conferenceId: string,
  qrToken: string,
  date: string | undefined,
  ctx: AuditContext = {},
): Promise<CheckinResult> {
  const [rows] = await pool.query(
    `SELECT r.id, r.conference_id, r.status, r.user_id, u.full_name, r.registration_number
     FROM registrations r JOIN users u ON u.id = r.user_id WHERE r.qr_token = ? LIMIT 1`,
    [qrToken],
  )
  const registration = (rows as Array<{ id: string; conference_id: string; status: string; user_id: string; full_name: string; registration_number: string }>)[0]
  if (!registration) throw new NotFoundError('This QR code is not registered for any conference.')
  return performCheckin(actorUserId, conferenceId, registration, 'qr', date, ctx)
}

export async function checkinByRegistrationId(
  actorUserId: string,
  conferenceId: string,
  registrationId: string,
  date: string | undefined,
  ctx: AuditContext = {},
): Promise<CheckinResult> {
  const [rows] = await pool.query(
    `SELECT r.id, r.conference_id, r.status, r.user_id, u.full_name, r.registration_number
     FROM registrations r JOIN users u ON u.id = r.user_id WHERE r.id = ? LIMIT 1`,
    [registrationId],
  )
  const registration = (rows as Array<{ id: string; conference_id: string; status: string; user_id: string; full_name: string; registration_number: string }>)[0]
  if (!registration) throw new NotFoundError('This registration does not exist.')
  return performCheckin(actorUserId, conferenceId, registration, 'manual', date, ctx)
}

export async function checkout(actorUserId: string, conferenceId: string, registrationId: string, ctx: AuditContext = {}): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const timezone = await loadConferenceTimezone(conn, conferenceId)
    const today = localDateKey(timezone)
    const [rows] = await conn.query(
      `SELECT id FROM conference_attendance WHERE conference_id = ? AND registration_id = ? AND attendance_date = ?
       AND checked_out_at IS NULL LIMIT 1 FOR UPDATE`,
      [conferenceId, registrationId, today],
    )
    const row = (rows as Array<{ id: string }>)[0]
    if (!row) throw new NotFoundError('No open check-in found for today.')
    await conn.query('UPDATE conference_attendance SET checked_out_at = NOW(3) WHERE id = ?', [row.id])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'attendance.check_out',
      entityType: 'conference_attendance',
      entityId: row.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

// -----------------------------------------------------------------------
// Attendance (per-session, optional)
// -----------------------------------------------------------------------

async function assertSessionAttendanceEnabled(conn: PoolConnection, conferenceId: string): Promise<void> {
  const [rows] = await conn.query('SELECT session_attendance_enabled FROM conference_settings WHERE conference_id = ? LIMIT 1', [
    conferenceId,
  ])
  const enabled = (rows as Array<{ session_attendance_enabled: number }>)[0]?.session_attendance_enabled
  if (!enabled) throw new ConflictError('Session attendance is not enabled for this conference.')
}

/** attendance.record (staff/convenor/manager), or a chair of this specific session. */
export async function assertCanRecordSessionAttendance(userId: string, conferenceId: string, sessionId: string): Promise<void> {
  try {
    await assertConferencePermission(userId, conferenceId, 'attendance.record')
    return
  } catch {
    // fall through to the chair check below
  }
  if (!(await canManageSessionAttendance(userId, conferenceId, sessionId))) {
    throw new ForbiddenError('You do not have permission to do this.')
  }
}

async function performSessionCheckin(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  registration: { id: string; conference_id: string; status: string; user_id: string },
  method: 'qr' | 'manual',
  ctx: AuditContext,
): Promise<{ full_name: string }> {
  return withTransaction(actorUserId, async (conn) => {
    await assertSessionAttendanceEnabled(conn, conferenceId)
    if (registration.conference_id !== conferenceId || registration.status !== 'confirmed') {
      throw new BadRequestError('This registration is not confirmed for this conference.')
    }
    const [sessionRows] = await conn.query(
      'SELECT id FROM conference_sessions WHERE id = ? AND conference_id = ? LIMIT 1',
      [sessionId, conferenceId],
    )
    if ((sessionRows as unknown[]).length === 0) throw new NotFoundError('This session does not exist.')

    try {
      await conn.query(
        `INSERT INTO session_attendance (conference_id, session_id, user_id, registration_id, method, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conferenceId, sessionId, registration.user_id, registration.id, method, actorUserId],
      )
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('Already checked in to this session.')
      }
      throw err
    }

    const [userRows] = await conn.query('SELECT full_name FROM users WHERE id = ? LIMIT 1', [registration.user_id])
    const fullName = (userRows as Array<{ full_name: string }>)[0]?.full_name ?? ''

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'session_attendance.check_in',
      entityType: 'session_attendance',
      entityId: sessionId,
      newValues: { registration_id: registration.id, method },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return { full_name: fullName }
  })
}

export async function sessionCheckinByQrToken(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  qrToken: string,
  ctx: AuditContext = {},
): Promise<{ full_name: string }> {
  const [rows] = await pool.query(
    `SELECT id, conference_id, status, user_id FROM registrations WHERE qr_token = ? LIMIT 1`,
    [qrToken],
  )
  const registration = (rows as Array<{ id: string; conference_id: string; status: string; user_id: string }>)[0]
  if (!registration) throw new NotFoundError('This QR code is not registered for any conference.')
  return performSessionCheckin(actorUserId, conferenceId, sessionId, registration, 'qr', ctx)
}

export async function sessionCheckinByRegistrationId(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  registrationId: string,
  ctx: AuditContext = {},
): Promise<{ full_name: string }> {
  const [rows] = await pool.query(
    `SELECT id, conference_id, status, user_id FROM registrations WHERE id = ? LIMIT 1`,
    [registrationId],
  )
  const registration = (rows as Array<{ id: string; conference_id: string; status: string; user_id: string }>)[0]
  if (!registration) throw new NotFoundError('This registration does not exist.')
  return performSessionCheckin(actorUserId, conferenceId, sessionId, registration, 'manual', ctx)
}

// -----------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------

export type AttendanceDashboard = {
  registered: number
  checked_in_today: number
  per_session: Array<{ session_id: string; title: string; count: number }>
}

export async function getAttendanceDashboard(conferenceId: string): Promise<AttendanceDashboard> {
  const timezone = await (async () => {
    const [rows] = await pool.query('SELECT timezone FROM conferences WHERE id = ? LIMIT 1', [conferenceId])
    return (rows as Array<{ timezone: string }>)[0]?.timezone ?? 'UTC'
  })()
  const today = localDateKey(timezone)

  const [registeredRows] = await pool.query(
    `SELECT COUNT(*) AS n FROM registrations WHERE conference_id = ? AND status = 'confirmed'`,
    [conferenceId],
  )
  const [todayRows] = await pool.query(
    `SELECT COUNT(*) AS n FROM conference_attendance WHERE conference_id = ? AND attendance_date = ?`,
    [conferenceId, today],
  )
  const [perSessionRows] = await pool.query(
    `SELECT s.id AS session_id, s.title, COUNT(sa.id) AS n
     FROM conference_sessions s LEFT JOIN session_attendance sa ON sa.session_id = s.id
     WHERE s.conference_id = ? GROUP BY s.id, s.title ORDER BY s.starts_at`,
    [conferenceId],
  )
  return {
    registered: Number((registeredRows as Array<{ n: number }>)[0]?.n ?? 0),
    checked_in_today: Number((todayRows as Array<{ n: number }>)[0]?.n ?? 0),
    per_session: (perSessionRows as Array<{ session_id: string; title: string; n: number }>).map((r) => ({
      session_id: r.session_id,
      title: r.title,
      count: Number(r.n),
    })),
  }
}
