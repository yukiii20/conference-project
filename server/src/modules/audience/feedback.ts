import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { assertConferenceInSession } from '../../middleware/sessionScope.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { csvRow } from '../../utils/csv.js'
import { ForbiddenError, NotFoundError } from '../../utils/errors.js'
import { getConferencePermissions, isPlatformAdmin } from '../auth/service.js'
import { assertConfirmedRegistration, getAudienceSettings, plainText } from './access.js'

const optionalComment = (label: string) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : plainText(v) || null))
    .pipe(z.string().max(1000, `${label} must be 1000 characters or fewer.`).nullable())

const rating = z.coerce.number().int('Choose 1 to 5 stars.').min(1, 'Choose 1 to 5 stars.').max(5, 'Choose 1 to 5 stars.')

export const conferenceFeedbackSchema = z.object({
  rating,
  liked: optionalComment('What you liked'),
  improve: optionalComment('What to improve'),
  comments: optionalComment('Comments'),
  is_anonymous: z.boolean().default(false),
})
export type ConferenceFeedbackInput = z.infer<typeof conferenceFeedbackSchema>

export const sessionRatingSchema = z.object({
  rating,
  comment: optionalComment('Your comment'),
  is_anonymous: z.boolean().default(false),
})
export type SessionRatingInput = z.infer<typeof sessionRatingSchema>

export const moderateFeedbackSchema = z.object({ status: z.enum(['visible', 'hidden']) })

function assertBeforeClosing(closesAt: Date | null, now: Date): void {
  if (closesAt && now > closesAt) throw new ForbiddenError('Feedback for this conference is closed.')
}

// ------------------------------------------------------------------ Audience side

export type MyFeedback = {
  closes_at: string | null
  conference: (ConferenceFeedbackInput & { updated_at: string }) | null
  ratings: Array<SessionRatingInput & { session_id: string; updated_at: string }>
}

export async function getMyFeedback(conferenceId: string, userId: string): Promise<MyFeedback> {
  const settings = await getAudienceSettings(conferenceId)
  const [[confRows], [ratingRows]] = await Promise.all([
    pool.query(
      `SELECT rating, liked, improve, comments, is_anonymous, updated_at FROM conference_feedback
       WHERE conference_id = ? AND audience_user_id = ? AND status <> 'deleted' LIMIT 1`,
      [conferenceId, userId],
    ),
    pool.query(
      `SELECT session_id, rating, comment, is_anonymous, updated_at FROM session_ratings
       WHERE conference_id = ? AND user_id = ? AND status <> 'deleted'`,
      [conferenceId, userId],
    ),
  ])
  const conf = (confRows as Array<Record<string, unknown>>)[0]
  return {
    closes_at: settings.audience_feedback_closes_at?.toISOString() ?? null,
    conference: conf
      ? {
          rating: Number(conf.rating),
          liked: (conf.liked as string | null) ?? null,
          improve: (conf.improve as string | null) ?? null,
          comments: (conf.comments as string | null) ?? null,
          is_anonymous: Boolean(conf.is_anonymous),
          updated_at: conf.updated_at as string,
        }
      : null,
    ratings: (ratingRows as Array<Record<string, unknown>>).map((r) => ({
      session_id: r.session_id as string,
      rating: Number(r.rating),
      comment: (r.comment as string | null) ?? null,
      is_anonymous: Boolean(r.is_anonymous),
      updated_at: r.updated_at as string,
    })),
  }
}

/**
 * One conference feedback per Audience member (UNIQUE conference_id + audience_user_id),
 * editable until the optional closing date. A row an organiser deleted stays deleted.
 */
export async function saveConferenceFeedback(
  conferenceId: string,
  userId: string,
  input: ConferenceFeedbackInput,
  now = new Date(),
): Promise<{ created: boolean }> {
  const settings = await getAudienceSettings(conferenceId)
  assertBeforeClosing(settings.audience_feedback_closes_at, now)
  return withTransaction(userId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, status FROM conference_feedback WHERE conference_id = ? AND audience_user_id = ? LIMIT 1 FOR UPDATE`,
      [conferenceId, userId],
    )
    const existing = (rows as Array<{ id: string; status: string }>)[0]
    if (existing?.status === 'deleted') throw new ForbiddenError('Your feedback was removed by the organisers and can no longer be changed.')
    if (existing) {
      await conn.query(
        `UPDATE conference_feedback SET rating = ?, liked = ?, improve = ?, comments = ?, is_anonymous = ? WHERE id = ?`,
        [input.rating, input.liked, input.improve, input.comments, input.is_anonymous, existing.id],
      )
      return { created: false }
    }
    await conn.query(
      `INSERT INTO conference_feedback (conference_id, rating, liked, improve, comments, participant_type, user_id, audience_user_id, source, is_anonymous)
       VALUES (?, ?, ?, ?, ?, 'attendee', ?, ?, 'audience', ?)`,
      [conferenceId, input.rating, input.liked, input.improve, input.comments, userId, userId, input.is_anonymous],
    )
    return { created: true }
  })
}

/**
 * Session rating: confirmed registration only, only once the session has started, one per
 * person per session (UNIQUE session_id + user_id), editable until the optional closing date.
 */
export async function saveSessionRating(
  conferenceId: string,
  sessionId: string,
  userId: string,
  input: SessionRatingInput,
  now = new Date(),
): Promise<{ created: boolean }> {
  await assertConfirmedRegistration(conferenceId, userId)
  const [sessionRows] = await pool.query(
    `SELECT status, starts_at FROM conference_sessions WHERE id = ? AND conference_id = ? LIMIT 1`,
    [sessionId, conferenceId],
  )
  const session = (sessionRows as Array<{ status: string; starts_at: string }>)[0]
  if (!session || session.status === 'draft') throw new NotFoundError('This session does not exist.')
  if (session.status === 'cancelled') throw new ForbiddenError('This session was cancelled.')
  if (now < new Date(session.starts_at)) throw new ForbiddenError('You can rate a session once it has started.')
  const settings = await getAudienceSettings(conferenceId)
  assertBeforeClosing(settings.audience_feedback_closes_at, now)

  return withTransaction(userId, async (conn) => {
    const [rows] = await conn.query(`SELECT id, status FROM session_ratings WHERE session_id = ? AND user_id = ? LIMIT 1 FOR UPDATE`, [
      sessionId,
      userId,
    ])
    const existing = (rows as Array<{ id: string; status: string }>)[0]
    if (existing?.status === 'deleted') throw new ForbiddenError('Your rating was removed by the organisers and can no longer be changed.')
    if (existing) {
      await conn.query(`UPDATE session_ratings SET rating = ?, comment = ?, is_anonymous = ? WHERE id = ?`, [
        input.rating,
        input.comment,
        input.is_anonymous,
        existing.id,
      ])
      return { created: false }
    }
    await conn.query(
      `INSERT INTO session_ratings (conference_id, session_id, user_id, rating, comment, is_anonymous) VALUES (?, ?, ?, ?, ?, ?)`,
      [conferenceId, sessionId, userId, input.rating, input.comment, input.is_anonymous],
    )
    return { created: true }
  })
}

// ------------------------------------------------------------------ Organiser side

/** Organisers (audience.moderate) see everything; a session chair sees only ratings of their own sessions. */
export type FeedbackScope = { all: true } | { all: false; sessionIds: string[] }

export async function getFeedbackScope(userId: string, conferenceId: string): Promise<FeedbackScope> {
  assertConferenceInSession(conferenceId)
  if (await isPlatformAdmin(userId)) return { all: true }
  const permissions = await getConferencePermissions(userId, conferenceId)
  if (permissions.has('audience.moderate')) return { all: true }
  const [rows] = await pool.query(
    `SELECT c.session_id FROM session_chairs c JOIN conference_sessions s ON s.id = c.session_id
     WHERE c.user_id = ? AND s.conference_id = ?`,
    [userId, conferenceId],
  )
  const sessionIds = (rows as Array<{ session_id: string }>).map((r) => r.session_id)
  if (sessionIds.length === 0) throw new ForbiddenError('Only the organisers and session chairs can see audience feedback.')
  return { all: false, sessionIds }
}

export function assertFullScope(scope: FeedbackScope): void {
  if (!scope.all) throw new ForbiddenError('Only the organisers can do this.')
}

export type FeedbackFilters = {
  kind?: 'conference' | 'session'
  session_id?: string
  rating?: number
  status?: 'visible' | 'hidden'
  with_comment?: boolean
  q?: string
}

export function parseFeedbackFilters(query: Record<string, unknown>): FeedbackFilters {
  const rating = Number(query.rating)
  return {
    kind: query.kind === 'conference' || query.kind === 'session' ? query.kind : undefined,
    session_id: typeof query.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(query.session_id) ? query.session_id : undefined,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
    status: query.status === 'visible' || query.status === 'hidden' ? query.status : undefined,
    with_comment: query.with_comment === 'true' || query.with_comment === '1',
    q: typeof query.q === 'string' && query.q.trim() ? query.q.trim().slice(0, 100) : undefined,
  }
}

export type FeedbackItem = {
  kind: 'conference' | 'session'
  id: string
  session_id: string | null
  session_title: string | null
  rating: number
  text: string | null
  /** null when anonymous. */
  author_name: string | null
  status: 'visible' | 'hidden'
  created_at: string
  updated_at: string
}

type Distribution = [number, number, number, number, number]

export type FeedbackSummary = {
  scope: 'all' | 'chair'
  conference: { count: number; average: number | null; distribution: Distribution } | null
  sessions: Array<{ session_id: string; title: string; starts_at: string; count: number; average: number | null; distribution: Distribution }>
  items: FeedbackItem[]
}

function distribution(values: number[]): Distribution {
  const d: Distribution = [0, 0, 0, 0, 0]
  for (const v of values) d[v - 1] = (d[v - 1] ?? 0) + 1
  return d
}

function average(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null
}

function conferenceText(r: { liked: string | null; improve: string | null; comments: string | null }): string | null {
  const parts = [
    r.liked ? `Liked: ${r.liked}` : null,
    r.improve ? `Improve: ${r.improve}` : null,
    r.comments ? `Comments: ${r.comments}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join('\n') : null
}

/** Averages + distribution (visible rows only), the per-session table, and the filtered comment list. */
export async function getFeedbackSummary(conferenceId: string, scope: FeedbackScope, filters: FeedbackFilters): Promise<FeedbackSummary> {
  const sessionScopeSql = scope.all ? '' : ' AND r.session_id IN (?)'
  const sessionScopeParams = scope.all ? [] : [scope.sessionIds]

  const [ratingRows] = await pool.query(
    `SELECT r.id, r.session_id, s.title AS session_title, s.starts_at, r.rating, r.comment, r.is_anonymous, r.status,
            r.created_at, r.updated_at, u.full_name
     FROM session_ratings r
     JOIN conference_sessions s ON s.id = r.session_id
     JOIN users u ON u.id = r.user_id
     WHERE r.conference_id = ? AND r.status <> 'deleted'${sessionScopeSql}
     ORDER BY r.created_at DESC`,
    [conferenceId, ...sessionScopeParams],
  )
  const ratings = ratingRows as Array<{
    id: string
    session_id: string
    session_title: string
    starts_at: string
    rating: number
    comment: string | null
    is_anonymous: number
    status: 'visible' | 'hidden'
    created_at: string
    updated_at: string
    full_name: string
  }>

  let conferenceRows: Array<{
    id: string
    rating: number
    liked: string | null
    improve: string | null
    comments: string | null
    is_anonymous: number
    status: 'visible' | 'hidden'
    created_at: string
    updated_at: string
    full_name: string | null
    name: string | null
  }> = []
  if (scope.all) {
    const [rows] = await pool.query(
      `SELECT f.id, f.rating, f.liked, f.improve, f.comments, f.is_anonymous, f.status, f.created_at,
              COALESCE(f.updated_at, f.created_at) AS updated_at, u.full_name, f.name
       FROM conference_feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.conference_id = ? AND f.status <> 'deleted'
       ORDER BY f.created_at DESC`,
      [conferenceId],
    )
    conferenceRows = rows as typeof conferenceRows
  }

  // Session table: every published session in scope, even with no ratings yet.
  const [sessionRows] = await pool.query(
    `SELECT s.id, s.title, s.starts_at FROM conference_sessions s
     WHERE s.conference_id = ? AND s.status = 'published'${scope.all ? '' : ' AND s.id IN (?)'}
     ORDER BY s.starts_at`,
    [conferenceId, ...sessionScopeParams],
  )
  const visibleRatings = ratings.filter((r) => r.status === 'visible')
  const sessions = (sessionRows as Array<{ id: string; title: string; starts_at: string }>).map((s) => {
    const values = visibleRatings.filter((r) => r.session_id === s.id).map((r) => Number(r.rating))
    return { session_id: s.id, title: s.title, starts_at: s.starts_at, count: values.length, average: average(values), distribution: distribution(values) }
  })
  const confValues = conferenceRows.filter((r) => r.status === 'visible').map((r) => Number(r.rating))

  const items: FeedbackItem[] = [
    ...conferenceRows.map((r) => ({
      kind: 'conference' as const,
      id: r.id,
      session_id: null,
      session_title: null,
      rating: Number(r.rating),
      text: conferenceText(r),
      author_name: r.is_anonymous ? null : (r.full_name ?? r.name ?? null),
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
    ...ratings.map((r) => ({
      kind: 'session' as const,
      id: r.id,
      session_id: r.session_id,
      session_title: r.session_title,
      rating: Number(r.rating),
      text: r.comment,
      author_name: r.is_anonymous ? null : r.full_name,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  ]
  const q = filters.q?.toLowerCase()
  const filtered = items
    .filter((i) => !filters.kind || i.kind === filters.kind)
    .filter((i) => !filters.session_id || i.session_id === filters.session_id)
    .filter((i) => !filters.rating || i.rating === filters.rating)
    .filter((i) => !filters.status || i.status === filters.status)
    .filter((i) => !filters.with_comment || Boolean(i.text))
    .filter((i) => !q || (i.text ?? '').toLowerCase().includes(q) || (i.session_title ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return {
    scope: scope.all ? 'all' : 'chair',
    conference: scope.all ? { count: confValues.length, average: average(confValues), distribution: distribution(confValues) } : null,
    sessions,
    items: filtered,
  }
}

const TABLES = { conference: 'conference_feedback', session: 'session_ratings' } as const

/** Hide/show (status) or delete (soft, status = 'deleted'). Organisers only; audit-logged. */
export async function moderateFeedback(
  actorUserId: string,
  conferenceId: string,
  kind: 'conference' | 'session',
  id: string,
  status: 'visible' | 'hidden' | 'deleted',
  ctx: AuditContext = {},
): Promise<void> {
  const table = TABLES[kind]
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(`SELECT status FROM ${table} WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`, [id, conferenceId])
    const current = (rows as Array<{ status: string }>)[0]
    if (!current || current.status === 'deleted') throw new NotFoundError('This feedback does not exist.')
    if (current.status === status) return
    if (kind === 'session') {
      await conn.query(`UPDATE session_ratings SET status = ?, moderated_by = ?, moderated_at = NOW(3) WHERE id = ?`, [status, actorUserId, id])
    } else {
      await conn.query(`UPDATE conference_feedback SET status = ? WHERE id = ?`, [status, id])
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: status === 'deleted' ? 'feedback.deleted' : 'feedback.moderated',
      entityType: table,
      entityId: id,
      oldValues: { status: current.status },
      newValues: { status },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export function feedbackCsv(summary: FeedbackSummary): string {
  const lines = [csvRow(['Type', 'Session', 'Rating', 'Feedback', 'From', 'Status', 'Submitted', 'Last edited'])]
  for (const i of summary.items) {
    lines.push(
      csvRow([
        i.kind === 'conference' ? 'Conference' : 'Session',
        i.session_title ?? '',
        i.rating,
        i.text ?? '',
        i.author_name ?? 'Anonymous',
        i.status,
        new Date(i.created_at).toISOString(),
        new Date(i.updated_at).toISOString(),
      ]),
    )
  }
  return lines.join('\r\n') + '\r\n'
}
