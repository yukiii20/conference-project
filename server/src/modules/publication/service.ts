import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'
import type { PaperPublicationInput, PublicationInfoInput, PublishAllInput } from './validation.js'

/**
 * Paper publication information (changes-nov2, Part 4).
 *  - Conference level: proceedings name, publisher, ISBN/ISSN, DOI prefix or link, date, note
 *    (columns publication_* on conference_settings).
 *  - Paper level: submission_publications (no row = not published).
 */

/** Papers that may be published: final approved or later. Never drafts, rejected, withdrawn or under review. */
export const PUBLISHABLE_STATUSES = ['final_approved', 'scheduled', 'presented', 'completed'] as const
const PUBLISHABLE_SQL = PUBLISHABLE_STATUSES.map((s) => `'${s}'`).join(',')

export type PublicationInfo = {
  title: string | null
  publisher: string | null
  isbn_issn: string | null
  link: string | null
  date: string | null
  note: string | null
}

const EMPTY_INFO: PublicationInfo = { title: null, publisher: null, isbn_issn: null, link: null, date: null, note: null }

export async function getPublicationInfo(conferenceId: string): Promise<PublicationInfo> {
  const [rows] = await pool.query(
    `SELECT publication_title AS title, publication_publisher AS publisher, publication_isbn_issn AS isbn_issn,
            publication_link AS link, publication_date AS date, publication_note AS note
     FROM conference_settings WHERE conference_id = ? LIMIT 1`,
    [conferenceId],
  )
  return (rows as PublicationInfo[])[0] ?? { ...EMPTY_INFO }
}

export function isPublicationInfoEmpty(info: PublicationInfo): boolean {
  return Object.values(info).every((v) => v == null || v === '')
}

/** Public conference page "Publication" section: null for an unpublished conference or when nothing is filled. */
export async function getPublicPublicationInfo(conferenceId: string): Promise<PublicationInfo | null> {
  const [conf] = await pool.query(`SELECT 1 FROM conferences WHERE id = ? AND deleted_at IS NULL AND status <> 'draft' LIMIT 1`, [conferenceId])
  if ((conf as unknown[]).length === 0) throw new NotFoundError('Conference not found.')
  const info = await getPublicationInfo(conferenceId)
  return isPublicationInfoEmpty(info) ? null : info
}

export async function updatePublicationInfo(
  actorUserId: string,
  conferenceId: string,
  input: PublicationInfoInput,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const old = await getPublicationInfo(conferenceId)
    await conn.query(
      `INSERT INTO conference_settings
         (conference_id, publication_title, publication_publisher, publication_isbn_issn, publication_link, publication_date, publication_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE publication_title = VALUES(publication_title), publication_publisher = VALUES(publication_publisher),
         publication_isbn_issn = VALUES(publication_isbn_issn), publication_link = VALUES(publication_link),
         publication_date = VALUES(publication_date), publication_note = VALUES(publication_note)`,
      [conferenceId, input.title, input.publisher, input.isbn_issn, input.link, input.date, input.note],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'publication_info.update',
      entityType: 'conference_settings',
      entityId: conferenceId,
      oldValues: old,
      newValues: input,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

// ------------------------------------------------------------------ Paper publication

export type PaperPublication = {
  is_published: boolean
  published_in: string | null
  doi_or_link: string | null
  publication_date: string | null
}

export type PaperPublicationRow = PaperPublication & {
  submission_id: string
  submission_code: string | null
  title: string
  status: string
  track_name: string | null
}

function toPublication(row: { is_published: number | boolean | null; published_in: string | null; doi_or_link: string | null; publication_date: string | null }): PaperPublication {
  return {
    is_published: Boolean(row.is_published),
    published_in: row.published_in ?? null,
    doi_or_link: row.doi_or_link ?? null,
    publication_date: row.publication_date ?? null,
  }
}

/** Every publishable paper of the conference with its publication record (convenor Papers tab). */
export async function listPaperPublications(conferenceId: string): Promise<PaperPublicationRow[]> {
  const [rows] = await pool.query(
    `SELECT s.id AS submission_id, s.submission_code, s.title, s.status, t.name AS track_name,
            sp.is_published, sp.published_in, sp.doi_or_link, sp.publication_date
     FROM submissions s
     LEFT JOIN conference_tracks t ON t.id = s.track_id
     LEFT JOIN submission_publications sp ON sp.submission_id = s.id
     WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status IN (${PUBLISHABLE_SQL})
     ORDER BY s.submission_code, s.title`,
    [conferenceId],
  )
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    submission_id: r.submission_id as string,
    submission_code: (r.submission_code as string | null) ?? null,
    title: r.title as string,
    status: r.status as string,
    track_name: (r.track_name as string | null) ?? null,
    ...toPublication(r as Parameters<typeof toPublication>[0]),
  }))
}

/** One paper's publication record; papers without a row are "not published". */
export async function getPaperPublication(conferenceId: string, submissionId: string): Promise<PaperPublication & { publishable: boolean }> {
  const [rows] = await pool.query(
    `SELECT s.status, sp.is_published, sp.published_in, sp.doi_or_link, sp.publication_date
     FROM submissions s LEFT JOIN submission_publications sp ON sp.submission_id = s.id
     WHERE s.id = ? AND s.conference_id = ? AND s.deleted_at IS NULL LIMIT 1`,
    [submissionId, conferenceId],
  )
  const row = (rows as Array<Parameters<typeof toPublication>[0] & { status: string }>)[0]
  if (!row) throw new NotFoundError('This paper does not exist.')
  return { ...toPublication(row), publishable: (PUBLISHABLE_STATUSES as readonly string[]).includes(row.status) }
}

export async function setPaperPublication(
  actorUserId: string,
  conferenceId: string,
  submissionId: string,
  input: PaperPublicationInput,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT s.status, sp.is_published, sp.published_in, sp.doi_or_link, sp.publication_date
       FROM submissions s LEFT JOIN submission_publications sp ON sp.submission_id = s.id
       WHERE s.id = ? AND s.conference_id = ? AND s.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [submissionId, conferenceId],
    )
    const current = (rows as Array<Parameters<typeof toPublication>[0] & { status: string }>)[0]
    if (!current) throw new NotFoundError('This paper does not exist.')
    if (input.is_published && !(PUBLISHABLE_STATUSES as readonly string[]).includes(current.status)) {
      throw new ConflictError('Only final-approved, scheduled, presented or completed papers can be marked as published.')
    }
    await conn.query(
      `INSERT INTO submission_publications (submission_id, conference_id, is_published, published_in, doi_or_link, publication_date, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_published = VALUES(is_published), published_in = VALUES(published_in),
         doi_or_link = VALUES(doi_or_link), publication_date = VALUES(publication_date), updated_by = VALUES(updated_by)`,
      [submissionId, conferenceId, input.is_published, input.published_in, input.doi_or_link, input.publication_date, actorUserId],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'paper_publication.update',
      entityType: 'submissions',
      entityId: submissionId,
      oldValues: toPublication(current),
      newValues: input,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

/**
 * Bulk "Publish all final-approved papers": marks every publishable paper as published. Values
 * a paper already has are kept; empty "Published in" falls back to the given value, then to the
 * conference's proceedings name. One audit entry per paper changed.
 */
export async function publishAllFinalApproved(
  actorUserId: string,
  conferenceId: string,
  input: PublishAllInput,
  ctx: AuditContext = {},
): Promise<{ published: number }> {
  return withTransaction(actorUserId, async (conn) => {
    const info = await getPublicationInfo(conferenceId)
    const defaultIn = input.published_in ?? info.title ?? null
    const defaultDate = input.publication_date ?? info.date ?? null
    const [rows] = await conn.query(
      `SELECT s.id, sp.is_published, sp.published_in, sp.doi_or_link, sp.publication_date
       FROM submissions s LEFT JOIN submission_publications sp ON sp.submission_id = s.id
       WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status IN (${PUBLISHABLE_SQL})
       FOR UPDATE`,
      [conferenceId],
    )
    let published = 0
    for (const row of rows as Array<Parameters<typeof toPublication>[0] & { id: string }>) {
      if (row.is_published) continue
      const next = {
        is_published: true,
        published_in: row.published_in ?? defaultIn,
        doi_or_link: row.doi_or_link ?? null,
        publication_date: row.publication_date ?? defaultDate,
      }
      await conn.query(
        `INSERT INTO submission_publications (submission_id, conference_id, is_published, published_in, doi_or_link, publication_date, updated_by)
         VALUES (?, ?, TRUE, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_published = TRUE, published_in = VALUES(published_in),
           publication_date = VALUES(publication_date), updated_by = VALUES(updated_by)`,
        [row.id, conferenceId, next.published_in, next.doi_or_link, next.publication_date, actorUserId],
      )
      await insertAuditLog(conn, {
        actorUserId,
        conferenceId,
        action: 'paper_publication.bulk_publish',
        entityType: 'submissions',
        entityId: row.id,
        oldValues: toPublication(row),
        newValues: next,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
      published += 1
    }
    return { published }
  })
}

/** Publication records for a set of submissions (author "My submissions"). */
export async function publicationsForSubmissions(submissionIds: string[]): Promise<Map<string, PaperPublication>> {
  if (submissionIds.length === 0) return new Map()
  const [rows] = await pool.query(
    `SELECT submission_id, is_published, published_in, doi_or_link, publication_date
     FROM submission_publications WHERE submission_id IN (?)`,
    [submissionIds],
  )
  return new Map(
    (rows as Array<Parameters<typeof toPublication>[0] & { submission_id: string }>).map((r) => [r.submission_id, toPublication(r)]),
  )
}
