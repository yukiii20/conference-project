import { createHmac, timingSafeEqual } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { buildPrivatePath, deletePrivateFile, savePrivateFile } from '../../storage/privateFileStore.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { isConferenceEnded } from '../../utils/conferenceEnded.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js'
import { plainText } from '../audience/access.js'
import { PUBLISHABLE_STATUSES } from '../publication/service.js'

/**
 * Past conference archive (changes-nov2, Part 3).
 *  - Public, only once the conference has ended: presented/scheduled/final-approved/completed
 *    papers (title, presenting names, date and session, abstract, track) - never drafts,
 *    rejected, withdrawn or under-review papers, reviews, scores, comments, emails or phones.
 *  - A full paper is downloadable only when the convenor marked it Published (Part 4), through
 *    a signed, expiring link served by the backend from private storage.
 *  - The conference report (text and/or PDF) once the convenor publishes it.
 */

const ARCHIVE_SQL_STATUSES = PUBLISHABLE_STATUSES.map((s) => `'${s}'`).join(',')
export const REPORT_PDF_MAX_BYTES = 20 * 1024 * 1024
const DOWNLOAD_LINK_SECONDS = 60 * 60 // a link from the archive page works for one hour

// ------------------------------------------------------------------ Signed download links

function sign(submissionId: string, expires: number): string {
  return createHmac('sha256', env.SESSION_SECRET).update(`archive-paper:${submissionId}:${expires}`).digest('base64url')
}

export function signPaperDownload(submissionId: string, now = Date.now()): { expires: number; sig: string } {
  const expires = Math.floor(now / 1000) + DOWNLOAD_LINK_SECONDS
  return { expires, sig: sign(submissionId, expires) }
}

export function verifyPaperDownload(submissionId: string, expires: unknown, sig: unknown, now = Date.now()): boolean {
  const exp = Number(expires)
  if (!Number.isInteger(exp) || typeof sig !== 'string' || exp * 1000 < now) return false
  const expected = Buffer.from(sign(submissionId, exp))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// ------------------------------------------------------------------ Public archive

type ConferenceRow = { id: string; end_date: string; status: string }

async function loadPublicConference(conferenceId: string): Promise<ConferenceRow> {
  const [rows] = await pool.query(
    `SELECT id, end_date, status FROM conferences WHERE id = ? AND deleted_at IS NULL AND status <> 'draft' LIMIT 1`,
    [conferenceId],
  )
  const row = (rows as ConferenceRow[])[0]
  if (!row) throw new NotFoundError('Conference not found.')
  return row
}

export type ArchivePaper = {
  id: string
  title: string
  abstract: string
  track_id: string | null
  track_name: string | null
  presenters: string[]
  session_title: string | null
  presented_at: string | null
  publication: { published_in: string | null; doi_or_link: string | null; publication_date: string | null } | null
  /** Signed backend link; only for papers marked Published that have a full paper file. */
  download_url: string | null
}

export type PublicArchive = {
  ended: boolean
  tracks: Array<{ id: string; name: string }>
  papers: ArchivePaper[]
  report: { body_text: string | null; has_pdf: boolean; published_at: string } | null
}

async function finalPaperFile(submissionId: string) {
  const [rows] = await pool.query(
    `SELECT storage_path, original_filename, mime_type FROM submission_files
     WHERE submission_id = ? AND file_kind IN ('camera_ready', 'full_paper') AND status = 'active'
     ORDER BY file_kind = 'camera_ready' DESC, is_final DESC, version DESC LIMIT 1`,
    [submissionId],
  )
  return (rows as Array<{ storage_path: string; original_filename: string; mime_type: string }>)[0] ?? null
}

export async function getPublicArchive(conferenceId: string): Promise<PublicArchive> {
  const conference = await loadPublicConference(conferenceId)
  if (!isConferenceEnded(conference.end_date)) return { ended: false, tracks: [], papers: [], report: null }

  const [paperRows] = await pool.query(
    `SELECT s.id, s.title, s.abstract, s.track_id, t.name AS track_name,
            p.presenter_user_id, pu.full_name AS presenter_name, p.starts_at AS presented_at, cs.title AS session_title,
            sp.is_published, sp.published_in, sp.doi_or_link, sp.publication_date,
            EXISTS (SELECT 1 FROM submission_files f WHERE f.submission_id = s.id AND f.file_kind IN ('camera_ready', 'full_paper')
                    AND f.status = 'active') AS has_file
     FROM submissions s
     LEFT JOIN conference_tracks t ON t.id = s.track_id
     LEFT JOIN presentations p ON p.submission_id = s.id AND p.status <> 'cancelled'
     LEFT JOIN users pu ON pu.id = p.presenter_user_id
     LEFT JOIN conference_sessions cs ON cs.id = p.session_id
     LEFT JOIN submission_publications sp ON sp.submission_id = s.id
     WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status IN (${ARCHIVE_SQL_STATUSES})
     ORDER BY p.starts_at IS NULL, p.starts_at, s.title`,
    [conferenceId],
  )
  const papers = paperRows as Array<Record<string, unknown>>
  const ids = papers.map((p) => p.id as string)

  // Author names only (never emails or phones): the presenting author when the programme names
  // one, otherwise every author in order.
  const authorsBySubmission = new Map<string, string[]>()
  if (ids.length > 0) {
    const [authorRows] = await pool.query(
      `SELECT submission_id, full_name FROM submission_authors WHERE submission_id IN (?) ORDER BY submission_id, author_order`,
      [ids],
    )
    for (const a of authorRows as Array<{ submission_id: string; full_name: string }>) {
      const list = authorsBySubmission.get(a.submission_id) ?? []
      list.push(a.full_name)
      authorsBySubmission.set(a.submission_id, list)
    }
  }

  const [trackRows] = await pool.query(
    `SELECT id, name FROM conference_tracks WHERE conference_id = ? AND is_active = TRUE ORDER BY display_order, name`,
    [conferenceId],
  )

  return {
    ended: true,
    tracks: trackRows as Array<{ id: string; name: string }>,
    papers: papers.map((p) => {
      const id = p.id as string
      const published = Boolean(p.is_published)
      const signed = published && Boolean(p.has_file) ? signPaperDownload(id) : null
      return {
        id,
        title: p.title as string,
        abstract: p.abstract as string,
        track_id: (p.track_id as string | null) ?? null,
        track_name: (p.track_name as string | null) ?? null,
        presenters: p.presenter_name ? [p.presenter_name as string] : (authorsBySubmission.get(id) ?? []),
        session_title: (p.session_title as string | null) ?? null,
        presented_at: p.presented_at ? new Date(p.presented_at as string).toISOString() : null,
        publication: published
          ? {
              published_in: (p.published_in as string | null) ?? null,
              doi_or_link: (p.doi_or_link as string | null) ?? null,
              publication_date: (p.publication_date as string | null) ?? null,
            }
          : null,
        download_url: signed
          ? `/api/conferences/${conferenceId}/archive/papers/${id}/file?expires=${signed.expires}&sig=${encodeURIComponent(signed.sig)}`
          : null,
      }
    }),
    report: await getPublishedReport(conferenceId),
  }
}

/** The file behind a signed archive link - re-checks that the paper is still published and the conference ended. */
export async function getArchivePaperFile(conferenceId: string, submissionId: string, expires: unknown, sig: unknown) {
  if (!verifyPaperDownload(submissionId, expires, sig)) {
    throw new ForbiddenError('This download link has expired. Open the conference archive again to get a new one.')
  }
  const conference = await loadPublicConference(conferenceId)
  if (!isConferenceEnded(conference.end_date)) throw new NotFoundError('Not found.')
  const [rows] = await pool.query(
    `SELECT 1 FROM submissions s JOIN submission_publications sp ON sp.submission_id = s.id AND sp.is_published = TRUE
     WHERE s.id = ? AND s.conference_id = ? AND s.deleted_at IS NULL AND s.status IN (${ARCHIVE_SQL_STATUSES}) LIMIT 1`,
    [submissionId, conferenceId],
  )
  if ((rows as unknown[]).length === 0) throw new NotFoundError('This paper is not published.')
  const file = await finalPaperFile(submissionId)
  if (!file) throw new NotFoundError('This paper has no file.')
  return file
}

// ------------------------------------------------------------------ Conference report

export type ConferenceReport = {
  body_text: string | null
  pdf_original_name: string | null
  has_pdf: boolean
  is_published: boolean
  published_at: string | null
  published_by_name: string | null
  updated_at: string | null
}

export const reportTextSchema = z.object({
  body_text: z
    .string()
    .nullable()
    .transform((v) => (v == null ? null : plainText(v).trim() || null))
    .pipe(z.string().max(20000, 'Keep the report to 20,000 characters or fewer.').nullable()),
})

export async function getReport(conferenceId: string): Promise<ConferenceReport> {
  const [rows] = await pool.query(
    `SELECT r.body_text, r.pdf_original_name, r.pdf_path IS NOT NULL AS has_pdf, r.is_published, r.published_at,
            u.full_name AS published_by_name, r.updated_at
     FROM conference_reports r LEFT JOIN users u ON u.id = r.published_by WHERE r.conference_id = ? LIMIT 1`,
    [conferenceId],
  )
  const row = (rows as Array<Record<string, unknown>>)[0]
  if (!row) {
    return { body_text: null, pdf_original_name: null, has_pdf: false, is_published: false, published_at: null, published_by_name: null, updated_at: null }
  }
  return {
    body_text: (row.body_text as string | null) ?? null,
    pdf_original_name: (row.pdf_original_name as string | null) ?? null,
    has_pdf: Boolean(row.has_pdf),
    is_published: Boolean(row.is_published),
    published_at: row.published_at ? new Date(row.published_at as string).toISOString() : null,
    published_by_name: (row.published_by_name as string | null) ?? null,
    updated_at: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  }
}

async function getPublishedReport(conferenceId: string): Promise<PublicArchive['report']> {
  const report = await getReport(conferenceId)
  if (!report.is_published || !report.published_at) return null
  return { body_text: report.body_text, has_pdf: report.has_pdf, published_at: report.published_at }
}

export async function saveReportText(actorUserId: string, conferenceId: string, bodyText: string | null, ctx: AuditContext = {}): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    await conn.query(
      `INSERT INTO conference_reports (conference_id, body_text, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE body_text = VALUES(body_text), updated_by = VALUES(updated_by)`,
      [conferenceId, bodyText, actorUserId],
    )
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference_report.save',
      entityType: 'conference_reports',
      entityId: conferenceId,
      newValues: { body_length: bodyText?.length ?? 0 },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

export async function uploadReportPdf(
  actorUserId: string,
  conferenceId: string,
  file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ctx: AuditContext = {},
): Promise<void> {
  if (!file) throw new BadRequestError('Choose a PDF file to upload.')
  if (file.size > REPORT_PDF_MAX_BYTES) throw new BadRequestError('The PDF must be 20 MB or smaller.')
  const sniffed = await fileTypeFromBuffer(file.buffer)
  if (sniffed?.mime !== 'application/pdf') throw new BadRequestError('Only PDF files can be uploaded as the conference report.')

  const key = buildPrivatePath(`conferences/${conferenceId}/report`, 'report', 1, 'pdf')
  await savePrivateFile(key, file.buffer)
  const name = `${file.originalname.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 120) || 'conference-report'}.pdf`
  let oldPath: string | null = null
  try {
    await withTransaction(actorUserId, async (conn) => {
      const [rows] = await conn.query('SELECT pdf_path FROM conference_reports WHERE conference_id = ? FOR UPDATE', [conferenceId])
      oldPath = (rows as Array<{ pdf_path: string | null }>)[0]?.pdf_path ?? null
      await conn.query(
        `INSERT INTO conference_reports (conference_id, pdf_path, pdf_original_name, updated_by) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE pdf_path = VALUES(pdf_path), pdf_original_name = VALUES(pdf_original_name), updated_by = VALUES(updated_by)`,
        [conferenceId, key, name, actorUserId],
      )
      await insertAuditLog(conn, {
        actorUserId,
        conferenceId,
        action: 'conference_report.upload_pdf',
        entityType: 'conference_reports',
        entityId: conferenceId,
        newValues: { filename: name, size_bytes: file.size },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
    })
  } catch (err) {
    await deletePrivateFile(key)
    throw err
  }
  if (oldPath) await deletePrivateFile(oldPath)
}

export async function removeReportPdf(actorUserId: string, conferenceId: string, ctx: AuditContext = {}): Promise<void> {
  let oldPath: string | null = null
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query('SELECT pdf_path FROM conference_reports WHERE conference_id = ? FOR UPDATE', [conferenceId])
    oldPath = (rows as Array<{ pdf_path: string | null }>)[0]?.pdf_path ?? null
    if (!oldPath) throw new NotFoundError('There is no PDF to remove.')
    await conn.query('UPDATE conference_reports SET pdf_path = NULL, pdf_original_name = NULL, updated_by = ? WHERE conference_id = ?', [
      actorUserId,
      conferenceId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'conference_report.remove_pdf',
      entityType: 'conference_reports',
      entityId: conferenceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
  if (oldPath) await deletePrivateFile(oldPath)
}

export async function setReportPublished(
  actorUserId: string,
  conferenceId: string,
  publish: boolean,
  ctx: AuditContext = {},
): Promise<void> {
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      'SELECT body_text, pdf_path, is_published FROM conference_reports WHERE conference_id = ? FOR UPDATE',
      [conferenceId],
    )
    const row = (rows as Array<{ body_text: string | null; pdf_path: string | null; is_published: number }>)[0]
    if (publish && (!row || (!row.body_text && !row.pdf_path))) {
      throw new ConflictError('Write the report or upload a PDF before publishing.')
    }
    if (!row) throw new NotFoundError('There is no report yet.')
    if (publish) {
      await conn.query(
        'UPDATE conference_reports SET is_published = TRUE, published_at = NOW(3), published_by = ? WHERE conference_id = ?',
        [actorUserId, conferenceId],
      )
    } else {
      await conn.query('UPDATE conference_reports SET is_published = FALSE WHERE conference_id = ?', [conferenceId])
    }
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: publish ? 'conference_report.publish' : 'conference_report.unpublish',
      entityType: 'conference_reports',
      entityId: conferenceId,
      oldValues: { is_published: Boolean(row.is_published) },
      newValues: { is_published: publish },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}

/** The report PDF: for organisers always, for everyone else only once published. */
export async function getReportPdf(conferenceId: string, opts: { publishedOnly: boolean }) {
  const [rows] = await pool.query(
    'SELECT pdf_path, pdf_original_name, is_published FROM conference_reports WHERE conference_id = ? LIMIT 1',
    [conferenceId],
  )
  const row = (rows as Array<{ pdf_path: string | null; pdf_original_name: string | null; is_published: number }>)[0]
  if (!row?.pdf_path || (opts.publishedOnly && !row.is_published)) throw new NotFoundError('There is no published report PDF.')
  if (opts.publishedOnly) await loadPublicConference(conferenceId)
  return { storage_path: row.pdf_path, filename: row.pdf_original_name ?? 'conference-report.pdf' }
}
