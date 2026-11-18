import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { ForbiddenError, NotFoundError } from '../../utils/errors.js'
import { getAudienceSettings, type AudienceSettings } from './access.js'

/** Accepted or later - never drafts, submitted, under review, revision, rejected or withdrawn papers. */
export const ACCEPTED_STATUSES = [
  'accepted',
  'full_paper_pending',
  'full_paper_submitted',
  'final_approved',
  'scheduled',
  'presented',
  'completed',
] as const

/**
 * The only fields that ever leave this module: no emails, reviews, scores, decision notes,
 * reviewer names, files or internal status - and author contact details never.
 */
export type AcceptedAbstract = {
  id: string
  submission_code: string | null
  title: string
  abstract: string
  keywords: string[]
  presentation_preference: string
  track: { id: string; name: string }
  authors: Array<{ full_name: string; affiliation: string | null }>
}

function keywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

export async function listAcceptedAbstracts(
  conferenceId: string,
  filters: { q?: string; track_id?: string },
): Promise<{ tracks: Array<{ id: string; name: string }>; abstracts: AcceptedAbstract[] }> {
  const where = ['s.conference_id = ?', 's.deleted_at IS NULL', 's.status IN (?)']
  const params: unknown[] = [conferenceId, ACCEPTED_STATUSES]
  if (filters.track_id) {
    where.push('s.track_id = ?')
    params.push(filters.track_id)
  }
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(`(s.title LIKE ? OR s.abstract LIKE ? OR s.submission_code LIKE ?
                 OR EXISTS (SELECT 1 FROM submission_authors sa WHERE sa.submission_id = s.id AND sa.full_name LIKE ?))`)
    params.push(like, like, like, like)
  }
  const [rows] = await pool.query(
    `SELECT s.id, s.submission_code, s.title, s.abstract, s.keywords, s.presentation_preference, t.id AS track_id, t.name AS track_name
     FROM submissions s JOIN conference_tracks t ON t.id = s.track_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.name, s.submission_code, s.title`,
    params,
  )
  const list = rows as Array<{
    id: string
    submission_code: string | null
    title: string
    abstract: string
    keywords: unknown
    presentation_preference: string
    track_id: string
    track_name: string
  }>

  const authors = new Map<string, AcceptedAbstract['authors']>()
  if (list.length > 0) {
    const [authorRows] = await pool.query(
      `SELECT submission_id, full_name, affiliation FROM submission_authors WHERE submission_id IN (?) ORDER BY submission_id, author_order`,
      [list.map((r) => r.id)],
    )
    for (const a of authorRows as Array<{ submission_id: string; full_name: string; affiliation: string | null }>) {
      authors.set(a.submission_id, [...(authors.get(a.submission_id) ?? []), { full_name: a.full_name, affiliation: a.affiliation }])
    }
  }

  const [trackRows] = await pool.query(
    `SELECT DISTINCT t.id, t.name FROM submissions s JOIN conference_tracks t ON t.id = s.track_id
     WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status IN (?) ORDER BY t.name`,
    [conferenceId, ACCEPTED_STATUSES],
  )

  return {
    tracks: trackRows as Array<{ id: string; name: string }>,
    abstracts: list.map((r) => ({
      id: r.id,
      submission_code: r.submission_code,
      title: r.title,
      abstract: r.abstract,
      keywords: keywords(r.keywords),
      presentation_preference: r.presentation_preference,
      track: { id: r.track_id, name: r.track_name },
      authors: authors.get(r.id) ?? [],
    })),
  }
}

export function parseAbstractFilters(query: Record<string, unknown>): { q?: string; track_id?: string } {
  return {
    q: typeof query.q === 'string' && query.q.trim() ? query.q.trim().slice(0, 100) : undefined,
    track_id: typeof query.track_id === 'string' && /^[0-9a-f-]{36}$/i.test(query.track_id) ? query.track_id : undefined,
  }
}

export async function assertAudienceAbstractsOn(conferenceId: string): Promise<void> {
  if (!(await getAudienceSettings(conferenceId)).audience_abstracts_enabled) {
    throw new ForbiddenError('The organisers have not published the accepted abstracts yet.')
  }
}

/** Public page: only when the organisers switched it on, and only for a published conference. */
export async function assertPublicAbstractsOn(conferenceId: string): Promise<void> {
  const [rows] = await pool.query(`SELECT status FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [conferenceId])
  const conference = (rows as Array<{ status: string }>)[0]
  if (!conference || conference.status === 'draft') throw new NotFoundError('This conference does not exist.')
  if (!(await getAudienceSettings(conferenceId)).public_abstracts_enabled) throw new NotFoundError('Not found.')
}

// ------------------------------------------------------------------ Audience settings (convenor/manager)

export const audienceSettingsSchema = z.object({
  qa_minutes_after_end: z.coerce.number().int('Use whole minutes.').min(0, 'Use 0 to 1440 minutes.').max(1440, 'Use 0 to 1440 minutes.'),
  audience_feedback_closes_at: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), 'Enter a valid date and time.'),
  schedule_change_emails: z.boolean(),
  audience_abstracts_enabled: z.boolean(),
  public_abstracts_enabled: z.boolean(),
})
export type AudienceSettingsInput = z.infer<typeof audienceSettingsSchema>

export async function readAudienceSettings(conferenceId: string): Promise<Omit<AudienceSettings, 'audience_feedback_closes_at'> & { audience_feedback_closes_at: string | null }> {
  const s = await getAudienceSettings(conferenceId)
  return { ...s, audience_feedback_closes_at: s.audience_feedback_closes_at?.toISOString() ?? null }
}

export async function saveAudienceSettings(
  actorUserId: string,
  conferenceId: string,
  input: AudienceSettingsInput,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT 1 FROM conference_settings WHERE conference_id = ? FOR UPDATE', [conferenceId])
    if ((rows as unknown[]).length === 0) {
      throw new NotFoundError('Save the conference settings once before changing the Audience settings.')
    }
    const old = await getAudienceSettings(conferenceId, conn)
    const closesAt = input.audience_feedback_closes_at ? new Date(input.audience_feedback_closes_at) : null
    await conn.query(
      `UPDATE conference_settings SET qa_minutes_after_end = ?, audience_feedback_closes_at = ?, schedule_change_emails = ?,
              audience_abstracts_enabled = ?, public_abstracts_enabled = ?
       WHERE conference_id = ?`,
      [input.qa_minutes_after_end, closesAt, input.schedule_change_emails, input.audience_abstracts_enabled, input.public_abstracts_enabled, conferenceId],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'settings.audience_update',
      entityType: 'conference_settings',
      entityId: conferenceId,
      oldValues: { ...old, audience_feedback_closes_at: old.audience_feedback_closes_at?.toISOString() ?? null },
      newValues: { ...input, audience_feedback_closes_at: closesAt?.toISOString() ?? null },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}
