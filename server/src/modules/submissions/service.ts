import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { insertAuditLog } from '../../utils/audit.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  mapDatabaseError,
} from '../../utils/errors.js'
import { notifyUser } from '../../utils/notifications.js'
import { assertConferenceInSession } from '../../middleware/sessionScope.js'
import type { AddAuthorInput, CreateSubmissionInput, UpdateAuthorInput, UpdateSubmissionInput } from './validation.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type ConferenceSettingsRow = {
  max_abstract_words: number
  max_file_size_mb: number
  max_submissions_per_author: number | null
  review_mode: 'open' | 'single_blind' | 'double_blind'
  authors_see_review_comments: number | boolean
  reviews_required: number
}

const DEFAULT_SETTINGS: ConferenceSettingsRow = {
  max_abstract_words: 300,
  max_file_size_mb: 20,
  max_submissions_per_author: null,
  review_mode: 'double_blind',
  authors_see_review_comments: true,
  reviews_required: 3,
}

export async function getConferenceSettings(conferenceId: string): Promise<ConferenceSettingsRow> {
  const [rows] = await pool.query(
    `SELECT max_abstract_words, max_file_size_mb, max_submissions_per_author, review_mode,
            authors_see_review_comments, reviews_required
     FROM conference_settings WHERE conference_id = ? LIMIT 1`,
    [conferenceId],
  )
  const row = (rows as ConferenceSettingsRow[])[0]
  return row ?? DEFAULT_SETTINGS
}

export async function assertActiveMember(userId: string, conferenceId: string): Promise<void> {
  assertConferenceInSession(conferenceId)
  const [rows] = await pool.query(
    `SELECT 1 FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active' LIMIT 1`,
    [userId, conferenceId],
  )
  if ((rows as unknown[]).length === 0) {
    throw new ForbiddenError('You are not an active member of this conference.')
  }
}

export async function assertActiveAuthorMember(userId: string, conferenceId: string): Promise<void> {
  assertConferenceInSession(conferenceId)
  const [rows] = await pool.query(
    `SELECT 1 FROM conference_members WHERE user_id = ? AND conference_id = ? AND role_code = 'author' AND status = 'active' LIMIT 1`,
    [userId, conferenceId],
  )
  if ((rows as unknown[]).length === 0) {
    throw new ForbiddenError('You are not an active author of this conference.')
  }
}

export type DeadlineWindow = { opens_at: string | null; closes_at: string | null; grace_minutes: number }

export async function loadDeadlineWindow(conferenceId: string, deadlineType: string): Promise<DeadlineWindow | null> {
  const [rows] = await pool.query(
    `SELECT opens_at, closes_at, grace_minutes FROM conference_deadlines WHERE conference_id = ? AND deadline_type = ? LIMIT 1`,
    [conferenceId, deadlineType],
  )
  return (rows as DeadlineWindow[])[0] ?? null
}

export function isWindowOpen(window: DeadlineWindow | null, now = new Date()): boolean {
  if (!window || !window.opens_at) return false
  if (now < new Date(window.opens_at)) return false
  if (window.closes_at) {
    const graceMs = (window.grace_minutes ?? 0) * 60_000
    if (now.getTime() > new Date(window.closes_at).getTime() + graceMs) return false
  }
  return true
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0
}

async function assertTrackInConference(conferenceId: string, trackId: string): Promise<void> {
  const [rows] = await pool.query(
    `SELECT 1 FROM conference_tracks WHERE id = ? AND conference_id = ? AND is_active = TRUE LIMIT 1`,
    [trackId, conferenceId],
  )
  if ((rows as unknown[]).length === 0) {
    throw new BadRequestError('Choose a valid, active track in this conference.', { track_id: 'Choose a valid track.' })
  }
}

// ---------------------------------------------------------------------------
// A1. Author form data
// ---------------------------------------------------------------------------

export type AuthorFormData = {
  tracks: Array<{ id: string; name: string }>
  settings: {
    max_abstract_words: number
    max_file_size_mb: number
    max_submissions_per_author: number | null
    review_mode: string
  }
  windows: Record<'abstract_submission' | 'full_paper' | 'final_paper', { opens_at: string | null; closes_at: string | null; is_open: boolean }>
  /** The convenor's guidelines (Markdown), shown above the abstract form. */
  submission_guidelines: string | null
}

export async function getAuthorFormData(userId: string, conferenceId: string): Promise<AuthorFormData> {
  await assertActiveMember(userId, conferenceId)

  const [trackRows] = await pool.query(
    `SELECT id, name FROM conference_tracks WHERE conference_id = ? AND is_active = TRUE ORDER BY display_order, name`,
    [conferenceId],
  )
  const settings = await getConferenceSettings(conferenceId)
  const [conferenceRows] = await pool.query('SELECT submission_guidelines FROM conferences WHERE id = ? LIMIT 1', [conferenceId])
  const submissionGuidelines = (conferenceRows as Array<{ submission_guidelines: string | null }>)[0]?.submission_guidelines ?? null

  const windowTypes = ['abstract_submission', 'full_paper', 'final_paper'] as const
  const windows: AuthorFormData['windows'] = {} as AuthorFormData['windows']
  for (const type of windowTypes) {
    const window = await loadDeadlineWindow(conferenceId, type)
    windows[type] = {
      opens_at: window?.opens_at ?? null,
      closes_at: window?.closes_at ?? null,
      is_open: isWindowOpen(window),
    }
  }

  return {
    tracks: trackRows as Array<{ id: string; name: string }>,
    settings: {
      max_abstract_words: settings.max_abstract_words,
      max_file_size_mb: settings.max_file_size_mb,
      max_submissions_per_author: settings.max_submissions_per_author,
      review_mode: settings.review_mode,
    },
    windows,
    submission_guidelines: submissionGuidelines,
  }
}

// ---------------------------------------------------------------------------
// A2. Submissions CRUD
// ---------------------------------------------------------------------------

export type MySubmissionRow = {
  id: string
  submission_code: string | null
  title: string
  status: string
  track_name: string
  updated_at: string
}

export async function listMySubmissions(userId: string, conferenceId: string): Promise<MySubmissionRow[]> {
  await assertActiveAuthorMember(userId, conferenceId)

  const [rows] = await pool.query(
    `SELECT s.id, s.submission_code, s.title, s.status, t.name AS track_name, s.updated_at
     FROM submissions s
     JOIN conference_tracks t ON t.id = s.track_id
     WHERE s.conference_id = ? AND s.deleted_at IS NULL
       AND (s.created_by = ? OR EXISTS (
         SELECT 1 FROM submission_authors sa WHERE sa.submission_id = s.id AND sa.user_id = ?
       ))
     ORDER BY s.updated_at DESC`,
    [conferenceId, userId, userId],
  )
  return rows as MySubmissionRow[]
}

export async function createSubmission(
  userId: string,
  conferenceId: string,
  input: CreateSubmissionInput,
): Promise<{ id: string }> {
  await assertActiveAuthorMember(userId, conferenceId)
  await assertTrackInConference(conferenceId, input.track_id)

  const settings = await getConferenceSettings(conferenceId)
  const words = countWords(input.abstract)
  if (words > settings.max_abstract_words) {
    throw new BadRequestError(`Abstract must be ${settings.max_abstract_words} words or fewer (currently ${words}).`, {
      abstract: `Abstract must be ${settings.max_abstract_words} words or fewer.`,
    })
  }

  return withTransaction(userId, async (conn) => {
    if (settings.max_submissions_per_author !== null) {
      const [countRows] = await conn.query(
        `SELECT COUNT(*) AS n FROM submissions
         WHERE conference_id = ? AND created_by = ? AND deleted_at IS NULL AND status <> 'withdrawn'`,
        [conferenceId, userId],
      )
      const count = (countRows as Array<{ n: number }>)[0]?.n ?? 0
      if (count >= settings.max_submissions_per_author) {
        throw new ConflictError(`You can have at most ${settings.max_submissions_per_author} active submission(s) in this conference.`)
      }
    }

    const [userRows] = await conn.query(`SELECT full_name, email FROM users WHERE id = ? LIMIT 1`, [userId])
    const user = (userRows as Array<{ full_name: string; email: string }>)[0]
    if (!user) throw new NotFoundError('Your account could not be found.')

    await conn.query(
      `INSERT INTO submissions (conference_id, track_id, title, abstract, keywords, presentation_preference, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [conferenceId, input.track_id, input.title, input.abstract, JSON.stringify(input.keywords), input.presentation_preference, userId],
    )
    const [idRows] = await conn.query(
      `SELECT id FROM submissions WHERE conference_id = ? AND created_by = ? ORDER BY created_at DESC LIMIT 1`,
      [conferenceId, userId],
    )
    const id = (idRows as Array<{ id: string }>)[0]?.id
    if (!id) throw new Error('Could not create the submission.')

    await conn.query(
      `INSERT INTO submission_authors (submission_id, user_id, author_order, full_name, email, is_corresponding)
       VALUES (?, ?, 1, ?, ?, TRUE)`,
      [id, userId, user.full_name, user.email],
    )

    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: 'submission.create',
      entityType: 'submissions',
      entityId: id,
      newValues: { title: input.title, track_id: input.track_id },
    })

    return { id }
  })
}

export type SubmissionCoreRow = {
  id: string
  conference_id: string
  track_id: string
  submission_code: string | null
  title: string
  abstract: string
  keywords: string[]
  presentation_preference: string
  status: string
  current_round: number
  created_by: string
  submitted_at: string | null
  withdrawn_at: string | null
}

export async function loadSubmissionCore(submissionId: string, conn: PoolConnection | typeof pool = pool): Promise<SubmissionCoreRow> {
  const [rows] = await conn.query(
    `SELECT id, conference_id, track_id, submission_code, title, abstract, keywords, presentation_preference,
            status, current_round, created_by, submitted_at, withdrawn_at
     FROM submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [submissionId],
  )
  const row = (rows as SubmissionCoreRow[])[0]
  if (!row) throw new NotFoundError('This submission does not exist.')
  // Every submission-by-id route (author, files, bids, ...) loads through
  // here: a session bound to another conference is refused centrally.
  assertConferenceInSession(row.conference_id)
  return row
}

export async function isAuthorOfSubmission(submissionId: string, userId: string, createdBy: string): Promise<boolean> {
  if (createdBy === userId) return true
  const [rows] = await pool.query(
    `SELECT 1 FROM submission_authors WHERE submission_id = ? AND user_id = ? LIMIT 1`,
    [submissionId, userId],
  )
  return (rows as unknown[]).length > 0
}

/** Loads a submission for its author, throwing 404 (never 403) if the caller isn't one of its authors — matches A2/A6: "other author cannot read/edit my submission (404)". */
async function loadSubmissionForAuthor(submissionId: string, userId: string): Promise<SubmissionCoreRow> {
  const row = await loadSubmissionCore(submissionId)
  if (!(await isAuthorOfSubmission(submissionId, userId, row.created_by))) {
    throw new NotFoundError('This submission does not exist.')
  }
  return row
}

const EDITABLE_STATUSES = new Set(['draft', 'revision_required'])
const WITHDRAWABLE_STATUSES = new Set([
  'draft',
  'submitted',
  'under_review',
  'revision_required',
  'accepted',
  'full_paper_pending',
  'full_paper_submitted',
  'final_approved',
  'scheduled',
])
export const ABSTRACT_UPLOAD_STATUSES = new Set(['draft', 'submitted', 'revision_required'])
export const FULL_PAPER_UPLOAD_STATUSES = new Set(['accepted', 'full_paper_pending', 'full_paper_submitted'])

export type SubmissionAuthorRow = {
  id: string
  author_order: number
  full_name: string
  email: string
  affiliation: string | null
  department: string | null
  country: string | null
  orcid: string | null
  is_corresponding: boolean
  user_id: string | null
}

export type SubmissionFileMetaRow = {
  id: string
  file_kind: string
  version: number
  status: string
  original_filename: string
  mime_type: string
  size_bytes: number
  uploaded_at: string
}

export type SubmissionStatusHistoryRow = {
  id: number
  from_status: string | null
  to_status: string
  reason: string | null
  changed_at: string
}

export type SubmissionDetail = {
  id: string
  submission_code: string | null
  title: string
  abstract: string
  keywords: string[]
  presentation_preference: string
  track_id: string
  status: string
  submitted_at: string | null
  authors: SubmissionAuthorRow[]
  files: SubmissionFileMetaRow[]
  status_history: SubmissionStatusHistoryRow[]
  feedback: Awaited<ReturnType<typeof getFeedback>>
  can_edit: boolean
  can_delete: boolean
  can_withdraw: boolean
  can_upload: { abstract: boolean; full_paper: boolean; slides: boolean; camera_ready: boolean }
}

export async function hasActiveReview(submissionId: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT 1 FROM review_assignments WHERE submission_id = ? AND status IN ('in_progress', 'completed') LIMIT 1`,
    [submissionId],
  )
  return (rows as unknown[]).length > 0
}

export async function getSubmissionDetail(userId: string, submissionId: string): Promise<SubmissionDetail> {
  const sub = await loadSubmissionForAuthor(submissionId, userId)

  const [authorRows] = await pool.query(
    `SELECT id, author_order, full_name, email, affiliation, department, country, orcid, is_corresponding, user_id
     FROM submission_authors WHERE submission_id = ? ORDER BY author_order`,
    [submissionId],
  )
  const [fileRows] = await pool.query(
    `SELECT id, file_kind, version, status, original_filename, mime_type, size_bytes, uploaded_at
     FROM submission_files WHERE submission_id = ? ORDER BY file_kind, version DESC`,
    [submissionId],
  )
  const [historyRows] = await pool.query(
    `SELECT id, from_status, to_status, reason, changed_at FROM submission_status_history
     WHERE submission_id = ? ORDER BY changed_at`,
    [submissionId],
  )

  const [fullPaperWindow, finalPaperWindow] = await Promise.all([
    loadDeadlineWindow(sub.conference_id, 'full_paper'),
    loadDeadlineWindow(sub.conference_id, 'final_paper'),
  ])
  const activeReview = await hasActiveReview(submissionId)
  const feedback = await getFeedback(sub.conference_id, submissionId)

  return {
    id: sub.id,
    submission_code: sub.submission_code,
    title: sub.title,
    abstract: sub.abstract,
    keywords: sub.keywords,
    presentation_preference: sub.presentation_preference,
    track_id: sub.track_id,
    status: sub.status,
    submitted_at: sub.submitted_at,
    authors: (authorRows as SubmissionAuthorRow[]).map((a) => ({ ...a, is_corresponding: Boolean(a.is_corresponding) })),
    files: fileRows as SubmissionFileMetaRow[],
    status_history: historyRows as SubmissionStatusHistoryRow[],
    feedback,
    can_edit: EDITABLE_STATUSES.has(sub.status),
    can_delete: (sub.status === 'draft' || sub.status === 'submitted') && !activeReview,
    can_withdraw: WITHDRAWABLE_STATUSES.has(sub.status),
    can_upload: {
      abstract: ABSTRACT_UPLOAD_STATUSES.has(sub.status),
      full_paper: FULL_PAPER_UPLOAD_STATUSES.has(sub.status) && isWindowOpen(fullPaperWindow),
      slides: FULL_PAPER_UPLOAD_STATUSES.has(sub.status) && isWindowOpen(fullPaperWindow),
      camera_ready: sub.status === 'final_approved' && isWindowOpen(finalPaperWindow),
    },
  }
}

export async function updateSubmission(userId: string, submissionId: string, input: UpdateSubmissionInput): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, conference_id, status, created_by, abstract FROM submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [submissionId],
    )
    const sub = (rows as Array<{ id: string; conference_id: string; status: string; created_by: string; abstract: string }>)[0]
    if (!sub || !(await isAuthorOfSubmission(submissionId, userId, sub.created_by))) {
      throw new NotFoundError('This submission does not exist.')
    }
    if (!EDITABLE_STATUSES.has(sub.status)) {
      throw new ConflictError('This submission can no longer be edited.')
    }

    if (input.track_id) {
      await assertTrackInConference(sub.conference_id, input.track_id)
    }

    const abstractToCheck = input.abstract ?? sub.abstract
    if (input.abstract !== undefined) {
      const settings = await getConferenceSettings(sub.conference_id)
      const words = countWords(abstractToCheck)
      if (words > settings.max_abstract_words) {
        throw new BadRequestError(`Abstract must be ${settings.max_abstract_words} words or fewer (currently ${words}).`, {
          abstract: `Abstract must be ${settings.max_abstract_words} words or fewer.`,
        })
      }
    }

    const assignments: string[] = []
    const values: unknown[] = []
    const newValues: Record<string, unknown> = {}
    if (input.track_id !== undefined) {
      assignments.push('track_id = ?')
      values.push(input.track_id)
      newValues.track_id = input.track_id
    }
    if (input.title !== undefined) {
      assignments.push('title = ?')
      values.push(input.title)
      newValues.title = input.title
    }
    if (input.abstract !== undefined) {
      assignments.push('abstract = ?')
      values.push(input.abstract)
      newValues.abstract = input.abstract
    }
    if (input.keywords !== undefined) {
      assignments.push('keywords = ?')
      values.push(JSON.stringify(input.keywords))
      newValues.keywords = input.keywords
    }
    if (input.presentation_preference !== undefined) {
      assignments.push('presentation_preference = ?')
      values.push(input.presentation_preference)
      newValues.presentation_preference = input.presentation_preference
    }
    if (assignments.length === 0) return

    values.push(submissionId)
    await conn.query(`UPDATE submissions SET ${assignments.join(', ')} WHERE id = ?`, values)
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: sub.conference_id,
      action: 'submission.update',
      entityType: 'submissions',
      entityId: submissionId,
      newValues,
    })
  })
}

export async function submitSubmission(userId: string, submissionId: string): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, conference_id, status, created_by FROM submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [submissionId],
    )
    const sub = (rows as Array<{ id: string; conference_id: string; status: string; created_by: string }>)[0]
    if (!sub || !(await isAuthorOfSubmission(submissionId, userId, sub.created_by))) {
      throw new NotFoundError('This submission does not exist.')
    }
    if (sub.status !== 'draft' && sub.status !== 'revision_required') {
      throw new ConflictError('This submission cannot be submitted from its current status.')
    }

    const isFirstSubmit = sub.status === 'draft'
    if (isFirstSubmit) {
      const window = await loadDeadlineWindow(sub.conference_id, 'abstract_submission')
      if (!isWindowOpen(window)) {
        throw new ConflictError('Abstract submission is not open right now.')
      }
    }

    try {
      await conn.query(`UPDATE submissions SET status = 'submitted' WHERE id = ?`, [submissionId])
    } catch (err) {
      mapDatabaseError(err)
    }

    if (isFirstSubmit) {
      await conn.query(
        `INSERT INTO conference_counters (conference_id, counter_key, current_value) VALUES (?, 'submission', 0)
         ON DUPLICATE KEY UPDATE conference_id = conference_id`,
        [sub.conference_id],
      )
      const [counterRows] = await conn.query(
        `SELECT current_value FROM conference_counters WHERE conference_id = ? AND counter_key = 'submission' FOR UPDATE`,
        [sub.conference_id],
      )
      const next = ((counterRows as Array<{ current_value: number }>)[0]?.current_value ?? 0) + 1
      await conn.query(
        `UPDATE conference_counters SET current_value = ? WHERE conference_id = ? AND counter_key = 'submission'`,
        [next, sub.conference_id],
      )
      const [confRows] = await conn.query(`SELECT code FROM conferences WHERE id = ? LIMIT 1`, [sub.conference_id])
      const conferenceCode = (confRows as Array<{ code: string }>)[0]?.code ?? 'SUB'
      const submissionCode = `${conferenceCode}-${String(next).padStart(4, '0')}`
      await conn.query(`UPDATE submissions SET submission_code = ? WHERE id = ?`, [submissionCode, submissionId])

      const [correspondingRows] = await conn.query(
        `SELECT full_name, email, user_id FROM submission_authors WHERE submission_id = ? AND is_corresponding = TRUE LIMIT 1`,
        [submissionId],
      )
      const [titleRows] = await conn.query(`SELECT title FROM submissions WHERE id = ? LIMIT 1`, [submissionId])
      const corresponding = (correspondingRows as Array<{ full_name: string; email: string; user_id: string | null }>)[0]
      const title = (titleRows as Array<{ title: string }>)[0]?.title ?? ''
      if (corresponding) {
        const [confCodeRows] = await conn.query(`SELECT code FROM conferences WHERE id = ? LIMIT 1`, [sub.conference_id])
        const confCode = (confCodeRows as Array<{ code: string }>)[0]?.code ?? ''
        const [templateRows] = await conn.query(
          `SELECT subject, body_html FROM email_templates WHERE conference_id IS NULL AND template_key = 'submission_received' LIMIT 1`,
        )
        const template = (templateRows as Array<{ subject: string; body_html: string }>)[0]
        const data = { full_name: corresponding.full_name, title, submission_code: submissionCode, conference_code: confCode }
        const subject = template ? renderTemplate(template.subject, data) : `Submission ${submissionCode} received`
        await queueEmail(conn, {
          userId,
          conferenceId: sub.conference_id,
          recipientEmail: corresponding.email,
          templateKey: 'submission_received',
          subject,
          templateData: data,
          entityType: 'submissions',
          entityId: submissionId,
        })
        if (corresponding.user_id) {
          await notifyUser(conn, {
            userId: corresponding.user_id,
            conferenceId: sub.conference_id,
            type: 'submission',
            title: 'Submission received',
            body: `"${title}" (${submissionCode}) was received.`,
            linkPath: '/portal/author',
            entityType: 'submissions',
            entityId: submissionId,
          })
        }
      }
    }

    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: sub.conference_id,
      action: 'submission.submit',
      entityType: 'submissions',
      entityId: submissionId,
    })
  })
}

export async function withdrawSubmission(userId: string, submissionId: string, reason?: string): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, conference_id, status, created_by FROM submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [submissionId],
    )
    const sub = (rows as Array<{ id: string; conference_id: string; status: string; created_by: string }>)[0]
    if (!sub || !(await isAuthorOfSubmission(submissionId, userId, sub.created_by))) {
      throw new NotFoundError('This submission does not exist.')
    }
    if (!WITHDRAWABLE_STATUSES.has(sub.status)) {
      throw new ConflictError('This submission cannot be withdrawn from its current status.')
    }

    await conn.query('SET @app_reason = ?', [reason ?? null])
    try {
      await conn.query(`UPDATE submissions SET status = 'withdrawn' WHERE id = ?`, [submissionId])
    } catch (err) {
      mapDatabaseError(err)
    }

    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: sub.conference_id,
      action: 'submission.withdraw',
      entityType: 'submissions',
      entityId: submissionId,
      newValues: { reason: reason ?? null },
    })
  })
}

export async function deleteSubmission(userId: string, submissionId: string): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, conference_id, status, created_by FROM submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [submissionId],
    )
    const sub = (rows as Array<{ id: string; conference_id: string; status: string; created_by: string }>)[0]
    if (!sub || !(await isAuthorOfSubmission(submissionId, userId, sub.created_by))) {
      throw new NotFoundError('This submission does not exist.')
    }
    if (sub.status !== 'draft' && sub.status !== 'submitted') {
      throw new ConflictError('Already under review.')
    }
    if (await hasActiveReview(submissionId)) {
      throw new ConflictError('Already under review.')
    }

    if (sub.status === 'submitted') {
      await conn.query('SET @app_reason = ?', ['Deleted by author'])
      try {
        await conn.query(`UPDATE submissions SET status = 'withdrawn' WHERE id = ?`, [submissionId])
      } catch (err) {
        mapDatabaseError(err)
      }
    }

    await conn.query(`UPDATE submissions SET deleted_at = NOW(3) WHERE id = ?`, [submissionId])
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: sub.conference_id,
      action: 'submission.delete',
      entityType: 'submissions',
      entityId: submissionId,
    })
  })
}

// ---------------------------------------------------------------------------
// A2. Co-authors
// ---------------------------------------------------------------------------

async function assertSubmissionEditableByAuthor(
  conn: PoolConnection,
  submissionId: string,
  userId: string,
): Promise<{ conference_id: string; status: string }> {
  const [rows] = await conn.query(
    `SELECT conference_id, status, created_by FROM submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [submissionId],
  )
  const sub = (rows as Array<{ conference_id: string; status: string; created_by: string }>)[0]
  if (!sub || !(await isAuthorOfSubmission(submissionId, userId, sub.created_by))) {
    throw new NotFoundError('This submission does not exist.')
  }
  if (!EDITABLE_STATUSES.has(sub.status)) {
    throw new ConflictError('Co-authors can only be changed while the submission is a draft or needs revision.')
  }
  return sub
}

export async function addAuthor(userId: string, submissionId: string, input: AddAuthorInput): Promise<{ id: string }> {
  return withTransaction(userId, async (conn) => {
    const sub = await assertSubmissionEditableByAuthor(conn, submissionId, userId)

    let linkedUserId: string | null = null
    if (input.is_corresponding) {
      const [userRows] = await conn.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [input.email])
      linkedUserId = (userRows as Array<{ id: string }>)[0]?.id ?? null
      if (!linkedUserId) {
        throw new BadRequestError('The corresponding author must already have an account with this email.', {
          email: 'This person needs an account first.',
        })
      }
      await conn.query(
        `UPDATE submission_authors SET is_corresponding = FALSE WHERE submission_id = ? AND is_corresponding = TRUE`,
        [submissionId],
      )
    } else {
      const [userRows] = await conn.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [input.email])
      linkedUserId = (userRows as Array<{ id: string }>)[0]?.id ?? null
    }

    const [orderRows] = await conn.query(
      `SELECT MAX(author_order) AS max_order FROM submission_authors WHERE submission_id = ?`,
      [submissionId],
    )
    const nextOrder = ((orderRows as Array<{ max_order: number | null }>)[0]?.max_order ?? 0) + 1

    try {
      await conn.query(
        `INSERT INTO submission_authors
           (submission_id, user_id, author_order, full_name, email, affiliation, department, country, orcid, is_corresponding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          submissionId,
          linkedUserId,
          nextOrder,
          input.full_name,
          input.email,
          input.affiliation ?? null,
          input.department ?? null,
          input.country ?? null,
          input.orcid ?? null,
          Boolean(input.is_corresponding),
        ],
      )
    } catch (err) {
      if (err && typeof err === 'object' && (err as { errno?: number }).errno === 1062) {
        throw new ConflictError('This email is already an author on this submission.')
      }
      throw err
    }

    const [idRows] = await conn.query(
      `SELECT id FROM submission_authors WHERE submission_id = ? AND email = ? LIMIT 1`,
      [submissionId, input.email],
    )
    const id = (idRows as Array<{ id: string }>)[0]!.id

    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: sub.conference_id,
      action: 'submission.author.add',
      entityType: 'submission_authors',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

async function reorderAuthor(
  conn: PoolConnection,
  submissionId: string,
  authorId: string,
  currentOrder: number,
  newOrder: number,
): Promise<void> {
  if (currentOrder === newOrder) return
  const [conflictRows] = await conn.query(
    `SELECT id FROM submission_authors WHERE submission_id = ? AND author_order = ? AND id <> ? LIMIT 1`,
    [submissionId, newOrder, authorId],
  )
  const conflict = (conflictRows as Array<{ id: string }>)[0]
  if (!conflict) {
    await conn.query(`UPDATE submission_authors SET author_order = ? WHERE id = ?`, [newOrder, authorId])
    return
  }

  const [usedRows] = await conn.query(`SELECT author_order FROM submission_authors WHERE submission_id = ?`, [submissionId])
  const used = new Set((usedRows as Array<{ author_order: number }>).map((r) => r.author_order))
  let temp = 1
  while (used.has(temp) && temp <= 50) temp++
  if (temp > 50) throw new ConflictError('Could not reorder authors.')

  await conn.query(`UPDATE submission_authors SET author_order = ? WHERE id = ?`, [temp, authorId])
  await conn.query(`UPDATE submission_authors SET author_order = ? WHERE id = ?`, [currentOrder, conflict.id])
  await conn.query(`UPDATE submission_authors SET author_order = ? WHERE id = ?`, [newOrder, authorId])
}

export async function updateAuthor(
  userId: string,
  submissionId: string,
  authorId: string,
  input: UpdateAuthorInput,
): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const sub = await assertSubmissionEditableByAuthor(conn, submissionId, userId)

    const [authorRows] = await conn.query(
      `SELECT id, author_order, email, is_corresponding FROM submission_authors WHERE id = ? AND submission_id = ? LIMIT 1 FOR UPDATE`,
      [authorId, submissionId],
    )
    const author = (authorRows as Array<{ id: string; author_order: number; email: string; is_corresponding: number }>)[0]
    if (!author) throw new NotFoundError('This author does not exist on this submission.')

    if (input.is_corresponding === true && !author.is_corresponding) {
      const emailToCheck = input.email ?? author.email
      const [userRows] = await conn.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [emailToCheck])
      const linkedUserId = (userRows as Array<{ id: string }>)[0]?.id
      if (!linkedUserId) {
        throw new BadRequestError('The corresponding author must already have an account with this email.', {
          email: 'This person needs an account first.',
        })
      }
      await conn.query(
        `UPDATE submission_authors SET is_corresponding = FALSE WHERE submission_id = ? AND is_corresponding = TRUE AND id <> ?`,
        [submissionId, authorId],
      )
      await conn.query(`UPDATE submission_authors SET user_id = ? WHERE id = ?`, [linkedUserId, authorId])
    }

    const assignments: string[] = []
    const values: unknown[] = []
    for (const key of ['full_name', 'email', 'affiliation', 'department', 'country', 'orcid', 'is_corresponding'] as const) {
      if (!(key in input)) continue
      assignments.push(`${key} = ?`)
      values.push((input as Record<string, unknown>)[key] ?? null)
    }
    if (assignments.length > 0) {
      values.push(authorId)
      await conn.query(`UPDATE submission_authors SET ${assignments.join(', ')} WHERE id = ?`, values)
    }

    if (input.author_order !== undefined) {
      await reorderAuthor(conn, submissionId, authorId, author.author_order, input.author_order)
    }

    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: sub.conference_id,
      action: 'submission.author.update',
      entityType: 'submission_authors',
      entityId: authorId,
      newValues: input,
    })
  })
}

export async function deleteAuthor(userId: string, submissionId: string, authorId: string): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const sub = await assertSubmissionEditableByAuthor(conn, submissionId, userId)

    const [countRows] = await conn.query(`SELECT COUNT(*) AS n FROM submission_authors WHERE submission_id = ?`, [submissionId])
    const count = (countRows as Array<{ n: number }>)[0]?.n ?? 0
    if (count <= 1) {
      throw new BadRequestError('A submission must have at least one author.')
    }

    const [authorRows] = await conn.query(
      `SELECT is_corresponding FROM submission_authors WHERE id = ? AND submission_id = ? LIMIT 1`,
      [authorId, submissionId],
    )
    const author = (authorRows as Array<{ is_corresponding: number }>)[0]
    if (!author) throw new NotFoundError('This author does not exist on this submission.')
    if (author.is_corresponding) {
      throw new BadRequestError('Make someone else the corresponding author first.')
    }

    await conn.query(`DELETE FROM submission_authors WHERE id = ?`, [authorId])
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId: sub.conference_id,
      action: 'submission.author.delete',
      entityType: 'submission_authors',
      entityId: authorId,
    })
  })
}

// ---------------------------------------------------------------------------
// A5. Feedback to the author
// ---------------------------------------------------------------------------

export async function getFeedback(conferenceId: string, submissionId: string) {
  const [decisionRows] = await pool.query(
    `SELECT stage, decision, comments_to_author, decided_at FROM submission_decisions
     WHERE submission_id = ? ORDER BY decided_at`,
    [submissionId],
  )

  const settings = await getConferenceSettings(conferenceId)
  let reviews: Array<{ review_number: number; comments_to_author: string | null; overall_score: number | null; recommendation: string | null }> = []
  if (settings.authors_see_review_comments) {
    const [reviewRows] = await pool.query(
      `SELECT r.comments_to_author, r.overall_score, r.recommendation, r.submitted_at
       FROM reviews r
       JOIN review_assignments ra ON ra.id = r.assignment_id
       WHERE ra.submission_id = ? AND r.status = 'submitted'
       ORDER BY r.submitted_at`,
      [submissionId],
    )
    const showScores = settings.review_mode === 'open'
    reviews = (reviewRows as Array<{ comments_to_author: string | null; overall_score: number | null; recommendation: string | null }>).map(
      (r, i) => ({
        review_number: i + 1,
        comments_to_author: r.comments_to_author,
        overall_score: showScores ? r.overall_score : null,
        recommendation: showScores ? r.recommendation : null,
      }),
    )
  }

  return {
    decisions: decisionRows as Array<{ stage: string; decision: string; comments_to_author: string | null; decided_at: string }>,
    reviews,
  }
}
