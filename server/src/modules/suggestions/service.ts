import sanitizeHtml from 'sanitize-html'
import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { queueEmail } from '../../utils/email.js'
import { getPlatformSettings } from '../platformSettings/service.js'
import { NotFoundError } from '../../utils/errors.js'
import type {
  CreateSuggestionInput,
  ExportSuggestionsQuery,
  ListSuggestionsQuery,
  SuggestionCategory,
  SuggestionStatus,
  UpdateSuggestionInput,
} from './validation.js'

const PAGE_SIZE = 20
const DIGEST_THROTTLE_MS = 15 * 60 * 1000

function stripHtml(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim()
}

/** Escapes LIKE wildcards in user-supplied search text so `%`/`_` aren't treated as patterns. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export type CreateSuggestionContext = {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Sends at most one admin-notification email per DIGEST_THROTTLE_MS, so a
 * burst of suggestions can never flood every admin's inbox one-by-one. The
 * email_logs table itself is the throttle clock (no extra table needed):
 * if the last 'new_suggestion' email went out less than the throttle window
 * ago, this is a no-op — whatever accumulates gets picked up as a single
 * digest the next time a suggestion arrives after the window has passed.
 */
async function maybeNotifyAdmins(conn: PoolConnection): Promise<void> {
  const settings = await getPlatformSettings()
  if (!settings.notify_admins_of_suggestions) return

  const [lastRows] = await conn.query(
    `SELECT queued_at FROM email_logs WHERE template_key = 'new_suggestion' ORDER BY queued_at DESC LIMIT 1`,
  )
  const last = (lastRows as Array<{ queued_at: string }>)[0]
  if (last && Date.now() - new Date(last.queued_at).getTime() < DIGEST_THROTTLE_MS) return

  const since = last ? last.queued_at : new Date(0)
  const [pendingRows] = await conn.query(
    `SELECT category FROM suggestions WHERE created_at > ? ORDER BY created_at DESC`,
    [since],
  )
  const pending = pendingRows as Array<{ category: SuggestionCategory }>
  if (pending.length === 0) return

  const subject = pending.length === 1 ? `New suggestion: ${pending[0]!.category}` : `${pending.length} new suggestions`

  const [adminRows] = await conn.query(
    `SELECT u.id, u.email FROM platform_user_roles pur JOIN users u ON u.id = pur.user_id
     WHERE pur.role_code = 'admin' AND u.status = 'active'`,
  )
  for (const admin of adminRows as Array<{ id: string; email: string }>) {
    await queueEmail(conn, {
      userId: admin.id,
      recipientEmail: admin.email,
      templateKey: 'new_suggestion',
      subject,
      templateData: { count: pending.length },
      entityType: 'suggestions',
    })
  }
}

export async function createSuggestion(input: CreateSuggestionInput, ctx: CreateSuggestionContext): Promise<void> {
  const clean = {
    name: input.name ? stripHtml(input.name) : null,
    email: input.email ?? null,
    category: input.category,
    message: stripHtml(input.message),
    page_url: input.page_url ? stripHtml(input.page_url) : null,
  }

  await withTransaction(ctx.userId, async (conn) => {
    await conn.query(
      `INSERT INTO suggestions (name, email, category, message, page_url, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [clean.name, clean.email, clean.category, clean.message, clean.page_url, ctx.userId],
    )
    await maybeNotifyAdmins(conn)
  })
}

export type SuggestionRow = {
  id: string
  name: string | null
  email: string | null
  category: SuggestionCategory
  message: string
  page_url: string | null
  user_id: string | null
  status: SuggestionStatus
  admin_note: string | null
  created_at: string
  updated_at: string
  handled_by: string | null
}

function buildListQuery(filters: { status?: SuggestionStatus; category?: SuggestionCategory; q?: string }): {
  where: string
  params: unknown[]
} {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.status) {
    conditions.push('status = ?')
    params.push(filters.status)
  }
  if (filters.category) {
    conditions.push('category = ?')
    params.push(filters.category)
  }
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`
    conditions.push(`(message LIKE ? ESCAPE '\\\\' OR name LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\')`)
    params.push(pattern, pattern, pattern)
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

export type ListSuggestionsResult = {
  suggestions: SuggestionRow[]
  page: number
  page_size: number
  total: number
  counts_by_status: Array<{ status: SuggestionStatus; count: number }>
}

export async function listSuggestions(query: ListSuggestionsQuery): Promise<ListSuggestionsResult> {
  const { where, params } = buildListQuery(query)
  const offset = (query.page - 1) * PAGE_SIZE

  const [[rows], [countRows], [statusRows]] = await Promise.all([
    pool.query(`SELECT * FROM suggestions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [
      ...params,
      PAGE_SIZE,
      offset,
    ]),
    pool.query(`SELECT COUNT(*) AS count FROM suggestions ${where}`, params),
    pool.query('SELECT status, COUNT(*) AS count FROM suggestions GROUP BY status'),
  ])

  const total = Number((countRows as Array<{ count: number }>)[0]?.count ?? 0)
  return {
    suggestions: rows as SuggestionRow[],
    page: query.page,
    page_size: PAGE_SIZE,
    total,
    counts_by_status: statusRows as Array<{ status: SuggestionStatus; count: number }>,
  }
}

/** Opening a NEW suggestion marks it read automatically — this is that read, done as a side effect of the admin viewing it. */
export async function getSuggestionAndMarkRead(
  actorUserId: string,
  id: string,
  ctx: AuditContext = {},
): Promise<SuggestionRow> {
  return withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM suggestions WHERE id = ? LIMIT 1 FOR UPDATE', [id])
    const row = (rows as SuggestionRow[])[0]
    if (!row) throw new NotFoundError('This suggestion does not exist.')
    if (row.status !== 'new') return row

    await conn.query("UPDATE suggestions SET status = 'read', handled_by = ? WHERE id = ?", [actorUserId, id])
    await insertAuditLog(conn, {
      actorUserId,
      action: 'suggestion.read',
      entityType: 'suggestions',
      entityId: id,
      oldValues: { status: 'new' },
      newValues: { status: 'read' },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
    return { ...row, status: 'read', handled_by: actorUserId }
  })
}

export async function updateSuggestion(
  actorUserId: string,
  id: string,
  input: UpdateSuggestionInput,
  ctx: AuditContext = {},
): Promise<SuggestionRow> {
  return withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM suggestions WHERE id = ? LIMIT 1 FOR UPDATE', [id])
    const before = (rows as SuggestionRow[])[0]
    if (!before) throw new NotFoundError('This suggestion does not exist.')

    const nextStatus = input.status ?? before.status
    const nextNote = input.admin_note !== undefined ? (input.admin_note ? stripHtml(input.admin_note) : null) : before.admin_note

    await conn.query('UPDATE suggestions SET status = ?, admin_note = ?, handled_by = ? WHERE id = ?', [
      nextStatus,
      nextNote,
      actorUserId,
      id,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      action: 'suggestion.update',
      entityType: 'suggestions',
      entityId: id,
      oldValues: { status: before.status, admin_note: before.admin_note },
      newValues: { status: nextStatus, admin_note: nextNote },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })

    return { ...before, status: nextStatus, admin_note: nextNote, handled_by: actorUserId }
  })
}

export async function deleteSuggestion(actorUserId: string, id: string, ctx: AuditContext = {}): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT id FROM suggestions WHERE id = ? LIMIT 1', [id])
    if ((rows as unknown[]).length === 0) throw new NotFoundError('This suggestion does not exist.')

    await conn.query('DELETE FROM suggestions WHERE id = ?', [id])
    await insertAuditLog(conn, {
      actorUserId,
      action: 'suggestion.delete',
      entityType: 'suggestions',
      entityId: id,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })
  })
}

function csvCell(value: unknown): string {
  // created_at comes back as a JS Date (mysql2 only stringifies DATE columns,
  // not DATETIME — see db/pool.ts's dateStrings config), so stringify it to
  // ISO text directly rather than via JSON.stringify, which would wrap it in
  // an extra pair of quotes that then get doubled again below.
  const text = value == null ? '' : value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : JSON.stringify(value)
  return `"${text.replace(/"/g, '""')}"`
}

const EXPORT_LIMIT = 5000

export async function exportSuggestionsCsv(filters: ExportSuggestionsQuery): Promise<string> {
  const { where, params } = buildListQuery(filters)
  const [rows] = await pool.query(
    `SELECT created_at, category, status, name, email, message, page_url, admin_note FROM suggestions ${where} ORDER BY created_at DESC LIMIT ?`,
    [...params, EXPORT_LIMIT],
  )

  const header = ['created_at', 'category', 'status', 'name', 'email', 'message', 'page_url', 'admin_note']
  const lines = [header.join(',')]
  for (const row of rows as Array<Record<string, unknown>>) {
    lines.push(header.map((key) => csvCell(row[key])).join(','))
  }
  return lines.join('\r\n')
}
