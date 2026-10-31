import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import { PUBLIC_DIR } from '../../storage/paths.js'
import { buildPrivatePath, deletePrivateFile, privateFileAbsolutePath, savePrivateFile } from '../../storage/privateFileStore.js'
import { generateAbstractBook, type BookAbstract, type BookGroup } from './export.js'
import type { GenerateBookInput } from './validation.js'

/** Everything from "accepted" onwards in the submission lifecycle. */
export const ACCEPTED_STATUSES = [
  'accepted',
  'full_paper_pending',
  'full_paper_submitted',
  'final_approved',
  'scheduled',
  'presented',
  'completed',
] as const

/** With "only accepted" off: every submitted abstract still in the running (never drafts, rejected or withdrawn). */
const ALL_SUBMITTED_STATUSES = [...ACCEPTED_STATUSES, 'submitted', 'under_review', 'revision_required'] as const

type ConferenceRow = {
  id: string
  name: string
  start_date: string
  end_date: string
  venue_name: string | null
  city: string | null
  logo_path: string | null
}

async function loadConference(conferenceId: string): Promise<ConferenceRow> {
  const [rows] = await pool.query(
    'SELECT id, name, start_date, end_date, venue_name, city, logo_path FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [conferenceId],
  )
  const row = (rows as ConferenceRow[])[0]
  if (!row) throw new NotFoundError('This conference does not exist.')
  return row
}

function formatDateRange(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const s = fmt.format(new Date(`${start}T00:00:00Z`))
  const e = fmt.format(new Date(`${end}T00:00:00Z`))
  return start === end ? s : `${s} - ${e}`
}

/** pdfkit only embeds PNG/JPEG; logos are normalised to PNG (and a missing/unreadable one is skipped). */
async function loadLogo(relativePath: string | null): Promise<Buffer | null> {
  if (!relativePath) return null
  try {
    return await sharp(await readFile(path.join(PUBLIC_DIR, relativePath))).png().toBuffer()
  } catch {
    return null
  }
}

function parseKeywords(value: unknown): string[] {
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

type SubmissionRow = {
  id: string
  submission_code: string | null
  title: string
  abstract: string
  keywords: unknown
  track_name: string
  session_id: string | null
  session_title: string | null
  session_starts_at: string | null
  presenter_user_id: string | null
  presentation_order: number | null
}

/** The abstracts the book would contain, already grouped and ordered. Exported for the convenor's preview count and for tests. */
export async function collectBookGroups(conferenceId: string, options: GenerateBookInput): Promise<BookGroup[]> {
  const statuses = options.only_accepted ? ACCEPTED_STATUSES : ALL_SUBMITTED_STATUSES
  // A paper's session only counts once that session is on the public programme.
  const [rows] = await pool.query(
    `SELECT s.id, s.submission_code, s.title, s.abstract, s.keywords, t.name AS track_name,
            cs.id AS session_id, cs.title AS session_title, cs.starts_at AS session_starts_at,
            p.presenter_user_id, p.presentation_order
     FROM submissions s
     JOIN conference_tracks t ON t.id = s.track_id
     LEFT JOIN presentations p ON p.submission_id = s.id AND p.status <> 'cancelled'
     LEFT JOIN conference_sessions cs ON cs.id = p.session_id AND cs.status = 'published'
     WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status IN (?)`,
    [conferenceId, statuses],
  )
  const submissions = rows as SubmissionRow[]
  if (submissions.length === 0) return []

  const [authorRows] = await pool.query(
    `SELECT submission_id, user_id, full_name, affiliation, is_corresponding
     FROM submission_authors WHERE submission_id IN (?) ORDER BY submission_id, author_order`,
    [submissions.map((s) => s.id)],
  )
  const authorsBySubmission = new Map<string, Array<{ user_id: string | null; full_name: string; affiliation: string | null; is_corresponding: number }>>()
  for (const a of authorRows as Array<{ submission_id: string; user_id: string | null; full_name: string; affiliation: string | null; is_corresponding: number }>) {
    authorsBySubmission.set(a.submission_id, [...(authorsBySubmission.get(a.submission_id) ?? []), a])
  }

  const toAbstract = (s: SubmissionRow): BookAbstract => {
    const authors = authorsBySubmission.get(s.id) ?? []
    // The scheduled presenter if there is one, otherwise the corresponding author.
    const presenterId = s.presenter_user_id ?? authors.find((a) => a.is_corresponding)?.user_id ?? null
    return {
      id: s.id,
      submission_code: s.submission_code,
      title: s.title,
      abstract: s.abstract,
      keywords: parseKeywords(s.keywords),
      authors: authors.map((a) => ({
        full_name: a.full_name,
        affiliation: a.affiliation,
        presenting: presenterId !== null && a.user_id === presenterId,
      })),
    }
  }
  const byTitle = (a: SubmissionRow, b: SubmissionRow) => a.title.localeCompare(b.title)

  if (options.order === 'title') {
    return [{ heading: 'Abstracts', abstracts: [...submissions].sort(byTitle).map(toAbstract) }]
  }

  if (options.order === 'session') {
    const groups = new Map<string, { title: string; startsAt: string; rows: SubmissionRow[] }>()
    const unscheduled: SubmissionRow[] = []
    for (const s of submissions) {
      if (!s.session_id) {
        unscheduled.push(s)
        continue
      }
      const g = groups.get(s.session_id) ?? { title: s.session_title!, startsAt: String(s.session_starts_at), rows: [] }
      g.rows.push(s)
      groups.set(s.session_id, g)
    }
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kathmandu',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
    const result: BookGroup[] = [...groups.values()]
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .map((g) => ({
        heading: g.title,
        subheading: timeFmt.format(new Date(g.startsAt)),
        abstracts: [...g.rows].sort((a, b) => (a.presentation_order ?? 0) - (b.presentation_order ?? 0)).map(toAbstract),
      }))
    if (unscheduled.length > 0) result.push({ heading: 'Not in the programme', abstracts: unscheduled.sort(byTitle).map(toAbstract) })
    return result
  }

  const byTrack = new Map<string, SubmissionRow[]>()
  for (const s of submissions) byTrack.set(s.track_name, [...(byTrack.get(s.track_name) ?? []), s])
  return [...byTrack.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([track, list]) => ({ heading: track, abstracts: [...list].sort(byTitle).map(toAbstract) }))
}

export type AbstractBookRow = {
  id: string
  options: GenerateBookInput
  abstract_count: number
  page_count: number
  is_published: boolean
  generated_at: string
}

async function loadBook(conferenceId: string): Promise<(AbstractBookRow & { file_path: string }) | null> {
  const [rows] = await pool.query(
    `SELECT id, file_path, options, abstract_count, page_count, is_published, generated_at
     FROM abstract_books WHERE conference_id = ? LIMIT 1`,
    [conferenceId],
  )
  const row = (rows as Array<Record<string, unknown>>)[0]
  if (!row) return null
  return {
    id: row.id as string,
    file_path: row.file_path as string,
    options: (typeof row.options === 'string' ? JSON.parse(row.options) : row.options) as GenerateBookInput,
    abstract_count: Number(row.abstract_count),
    page_count: Number(row.page_count),
    is_published: Boolean(row.is_published),
    generated_at: row.generated_at as string,
  }
}

/** The convenor's screen: the current book (if any) and whether a programme has been published (to suggest session order). */
export async function getAbstractBookStatus(
  conferenceId: string,
): Promise<{ book: AbstractBookRow | null; accepted_count: number; submitted_count: number; programme_published: boolean }> {
  await loadConference(conferenceId)
  const book = await loadBook(conferenceId)
  const [countRows] = await pool.query(
    `SELECT SUM(status IN (?)) AS accepted_count, SUM(status IN (?)) AS submitted_count
     FROM submissions WHERE conference_id = ? AND deleted_at IS NULL`,
    [ACCEPTED_STATUSES, ALL_SUBMITTED_STATUSES, conferenceId],
  )
  const counts = (countRows as Array<{ accepted_count: number | null; submitted_count: number | null }>)[0]
  const [programmeRows] = await pool.query(
    `SELECT 1 FROM conference_sessions WHERE conference_id = ? AND status = 'published' LIMIT 1`,
    [conferenceId],
  )
  let publicBook: AbstractBookRow | null = null
  if (book) {
    const { file_path: _filePath, ...rest } = book
    publicBook = rest
  }
  return {
    book: publicBook,
    accepted_count: Number(counts?.accepted_count ?? 0),
    submitted_count: Number(counts?.submitted_count ?? 0),
    programme_published: (programmeRows as unknown[]).length > 0,
  }
}

/** Builds the PDF, stores it (replacing any earlier one) and keeps the publish toggle as it was. */
export async function generateBook(
  actorUserId: string,
  conferenceId: string,
  options: GenerateBookInput,
  audit: AuditContext = {},
): Promise<AbstractBookRow> {
  const conference = await loadConference(conferenceId)
  const groups = await collectBookGroups(conferenceId, options)
  const { buffer, pageCount } = await generateAbstractBook(
    {
      name: conference.name,
      dateRange: formatDateRange(conference.start_date, conference.end_date),
      venue: [conference.venue_name, conference.city].filter(Boolean).join(', ') || null,
      logo: await loadLogo(conference.logo_path),
    },
    groups,
  )
  const abstractCount = groups.reduce((n, g) => n + g.abstracts.length, 0)

  const previous = await loadBook(conferenceId)
  const filePath = buildPrivatePath(`abstract-books/${conferenceId}`, 'book', (previous ? 1 : 0) + 1, 'pdf')
  await savePrivateFile(filePath, buffer)

  try {
    await withTransaction(actorUserId, async (conn) => {
      await conn.query(
        `INSERT INTO abstract_books (conference_id, file_path, options, abstract_count, page_count, generated_at, generated_by)
         VALUES (?, ?, ?, ?, ?, NOW(3), ?)
         ON DUPLICATE KEY UPDATE file_path = VALUES(file_path), options = VALUES(options), abstract_count = VALUES(abstract_count),
           page_count = VALUES(page_count), generated_at = VALUES(generated_at), generated_by = VALUES(generated_by)`,
        [conferenceId, filePath, JSON.stringify(options), abstractCount, pageCount, actorUserId],
      )
      await insertAuditLog(conn, {
        actorUserId,
        conferenceId,
        action: 'abstract_book.generate',
        entityType: 'abstract_books',
        entityId: conferenceId,
        newValues: { ...options, abstract_count: abstractCount, page_count: pageCount },
        ...audit,
      })
    })
  } catch (err) {
    await deletePrivateFile(filePath)
    throw err
  }
  if (previous) await deletePrivateFile(previous.file_path)

  const book = await loadBook(conferenceId)
  const { file_path: _filePath, ...rest } = book!
  return rest
}

export async function setBookPublished(
  actorUserId: string,
  conferenceId: string,
  isPublished: boolean,
  audit: AuditContext = {},
): Promise<void> {
  const book = await loadBook(conferenceId)
  if (!book) throw new NotFoundError('Generate the book of abstracts first.')
  await withTransaction(actorUserId, async (conn) => {
    await conn.query('UPDATE abstract_books SET is_published = ? WHERE conference_id = ?', [isPublished, conferenceId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: isPublished ? 'abstract_book.publish' : 'abstract_book.unpublish',
      entityType: 'abstract_books',
      entityId: conferenceId,
      oldValues: { is_published: book.is_published },
      newValues: { is_published: isPublished },
      ...audit,
    })
  })
}

export async function bookFile(conferenceId: string, opts: { publicOnly: boolean }): Promise<{ absolutePath: string; filename: string }> {
  const book = await loadBook(conferenceId)
  if (!book || (opts.publicOnly && !book.is_published)) throw new NotFoundError('The book of abstracts is not available.')
  return { absolutePath: privateFileAbsolutePath(book.file_path), filename: 'book-of-abstracts.pdf' }
}

/** For the public conference page: is there a published book to link to? */
export async function getPublicBookInfo(conferenceId: string): Promise<{ available: boolean; generated_at: string | null }> {
  const book = await loadBook(conferenceId)
  return book?.is_published ? { available: true, generated_at: book.generated_at } : { available: false, generated_at: null }
}
