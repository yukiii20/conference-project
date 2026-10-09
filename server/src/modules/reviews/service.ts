import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { assertConferencePermission } from '../../middleware/auth.js'
import { getConferencePermissions, isPlatformAdmin } from '../../modules/auth/service.js'
import { insertAuditLog } from '../../utils/audit.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { BadRequestError, ConflictError, NotFoundError, mapDatabaseError } from '../../utils/errors.js'
import { notifyUser } from '../../utils/notifications.js'
import type { AddConflictInput, AssignReviewerInput, DecisionInput, SaveReviewDraftInput, SubmitReviewInput } from './validation.js'

async function hasPermission(userId: string, conferenceId: string, permission: string): Promise<boolean> {
  if (await isPlatformAdmin(userId)) return true
  const permissions = await getConferencePermissions(userId, conferenceId)
  return permissions.has(permission)
}

// ---------------------------------------------------------------------------
// B1. Convenor/manager submissions overview
// ---------------------------------------------------------------------------

export type SubmissionsOverviewRow = {
  id: string
  submission_code: string | null
  title: string
  status: string
  track_name: string
  submitted_at: string | null
  assignment_count: number
  completed_count: number
  avg_score: number | null
}

export async function listSubmissionsOverview(
  actorUserId: string,
  conferenceId: string,
  filters: { status?: string; track_id?: string; q?: string },
): Promise<SubmissionsOverviewRow[]> {
  await assertConferencePermission(actorUserId, conferenceId, 'submission.read_all')

  const conditions = ['s.conference_id = ?', "s.status <> 'draft'", 's.deleted_at IS NULL']
  const params: unknown[] = [conferenceId]
  if (filters.status) {
    conditions.push('s.status = ?')
    params.push(filters.status)
  }
  if (filters.track_id) {
    conditions.push('s.track_id = ?')
    params.push(filters.track_id)
  }
  if (filters.q) {
    conditions.push('s.title LIKE ?')
    params.push(`%${filters.q}%`)
  }

  const [rows] = await pool.query(
    `SELECT s.id, s.submission_code, s.title, s.status, t.name AS track_name, s.submitted_at,
            (SELECT COUNT(*) FROM review_assignments ra WHERE ra.submission_id = s.id AND ra.status <> 'cancelled') AS assignment_count,
            (SELECT COUNT(*) FROM review_assignments ra JOIN reviews r ON r.assignment_id = ra.id
               WHERE ra.submission_id = s.id AND r.status = 'submitted') AS completed_count,
            (SELECT AVG(r.overall_score) FROM review_assignments ra JOIN reviews r ON r.assignment_id = ra.id
               WHERE ra.submission_id = s.id AND r.status = 'submitted') AS avg_score
     FROM submissions s
     JOIN conference_tracks t ON t.id = s.track_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.updated_at DESC`,
    params,
  )
  return (rows as SubmissionsOverviewRow[]).map((r) => ({ ...r, avg_score: r.avg_score === null ? null : Number(r.avg_score) }))
}

async function loadSubmissionInConference(
  submissionId: string,
  conferenceId: string,
  conn: PoolConnection | typeof pool = pool,
): Promise<{
  id: string
  conference_id: string
  track_id: string
  status: string
  current_round: number
  created_by: string
}> {
  const [rows] = await conn.query(
    `SELECT id, conference_id, track_id, status, current_round, created_by
     FROM submissions WHERE id = ? AND conference_id = ? AND deleted_at IS NULL LIMIT 1`,
    [submissionId, conferenceId],
  )
  const row = (rows as Array<{ id: string; conference_id: string; track_id: string; status: string; current_round: number; created_by: string }>)[0]
  if (!row) throw new NotFoundError('This submission does not exist.')
  return row
}

export async function getSubmissionOverviewDetail(actorUserId: string, conferenceId: string, submissionId: string) {
  await assertConferencePermission(actorUserId, conferenceId, 'submission.read_all')
  const sub = await loadSubmissionInConference(submissionId, conferenceId)
  const canSeeReviews = await hasPermission(actorUserId, conferenceId, 'review.read_all')

  const [coreRows] = await pool.query(
    `SELECT id, submission_code, title, abstract, keywords, presentation_preference, status, current_round, submitted_at
     FROM submissions WHERE id = ? LIMIT 1`,
    [submissionId],
  )
  const core = (coreRows as unknown[])[0]

  const [authorRows] = await pool.query(
    `SELECT sa.id, sa.full_name, sa.email, sa.affiliation, sa.country, sa.is_corresponding, sa.user_id, u.photo_path
     FROM submission_authors sa LEFT JOIN users u ON u.id = sa.user_id
     WHERE sa.submission_id = ? ORDER BY sa.author_order`,
    [submissionId],
  )
  const [fileRows] = await pool.query(
    `SELECT id, file_kind, version, status, original_filename, mime_type, size_bytes, uploaded_at
     FROM submission_files WHERE submission_id = ? ORDER BY file_kind, version DESC`,
    [submissionId],
  )

  const reviewFields = canSeeReviews
    ? `r.status AS review_status, r.originality, r.quality, r.relevance, r.methodology, r.overall_score, r.confidence,
       r.recommendation, r.comments_to_author, r.confidential_comments`
    : `r.status AS review_status`
  const [assignmentRows] = await pool.query(
    `SELECT ra.id, ra.status, ra.due_at, ra.reviewer_id, u.full_name AS reviewer_name, u.email AS reviewer_email, ${reviewFields}
     FROM review_assignments ra
     JOIN users u ON u.id = ra.reviewer_id
     LEFT JOIN reviews r ON r.assignment_id = ra.id
     WHERE ra.submission_id = ? ORDER BY ra.assigned_at`,
    [submissionId],
  )

  const [decisionRows] = await pool.query(
    `SELECT id, stage, decision, comments_to_author, internal_notes, decided_at FROM submission_decisions
     WHERE submission_id = ? ORDER BY decided_at DESC`,
    [submissionId],
  )
  const [historyRows] = await pool.query(
    `SELECT id, from_status, to_status, reason, changed_at FROM submission_status_history
     WHERE submission_id = ? ORDER BY changed_at`,
    [submissionId],
  )

  return {
    submission: core,
    authors: (authorRows as Array<Record<string, unknown>>).map((a) => ({ ...a, is_corresponding: Boolean(a.is_corresponding) })),
    files: fileRows,
    assignments: assignmentRows,
    decisions: decisionRows,
    status_history: historyRows,
  }
}

// ---------------------------------------------------------------------------
// B2. Assigning reviewers
// ---------------------------------------------------------------------------

export type ReviewerCandidateRow = {
  user_id: string
  full_name: string
  email: string
  has_conflict: boolean
  already_assigned: boolean
  is_author_of_submission: boolean
  track_match: boolean
  open_assignment_count: number
}

export async function listReviewerCandidates(
  actorUserId: string,
  conferenceId: string,
  submissionId: string,
): Promise<ReviewerCandidateRow[]> {
  await assertConferencePermission(actorUserId, conferenceId, 'review.assign')
  const sub = await loadSubmissionInConference(submissionId, conferenceId)

  const [memberRows] = await pool.query(
    `SELECT u.id AS user_id, u.full_name, u.email
     FROM conference_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.conference_id = ? AND cm.role_code = 'reviewer' AND cm.status = 'active'`,
    [conferenceId],
  )
  const reviewers = memberRows as Array<{ user_id: string; full_name: string; email: string }>
  if (reviewers.length === 0) return []

  const [conflictRows] = await pool.query(
    `SELECT user_id FROM conflicts_of_interest WHERE submission_id = ?`,
    [submissionId],
  )
  const conflictIds = new Set((conflictRows as Array<{ user_id: string }>).map((r) => r.user_id))

  const [assignedRows] = await pool.query(
    `SELECT reviewer_id FROM review_assignments WHERE submission_id = ? AND round = ? AND status <> 'cancelled'`,
    [submissionId, sub.current_round],
  )
  const assignedIds = new Set((assignedRows as Array<{ reviewer_id: string }>).map((r) => r.reviewer_id))

  const [authorRows] = await pool.query(
    `SELECT user_id, email FROM submission_authors WHERE submission_id = ?`,
    [submissionId],
  )
  const authorUserIds = new Set(
    (authorRows as Array<{ user_id: string | null; email: string }>).map((r) => r.user_id).filter((v): v is string => Boolean(v)),
  )
  const authorEmails = new Set((authorRows as Array<{ email: string }>).map((r) => r.email.toLowerCase()))

  const [trackRows] = await pool.query(
    `SELECT user_id FROM reviewer_tracks WHERE conference_id = ? AND track_id = ?`,
    [conferenceId, sub.track_id],
  )
  const trackMatchIds = new Set((trackRows as Array<{ user_id: string }>).map((r) => r.user_id))

  const [loadRows] = await pool.query(
    `SELECT reviewer_id, COUNT(*) AS n FROM review_assignments
     WHERE conference_id = ? AND status IN ('assigned', 'in_progress') GROUP BY reviewer_id`,
    [conferenceId],
  )
  const loadByReviewer = new Map((loadRows as Array<{ reviewer_id: string; n: number }>).map((r) => [r.reviewer_id, r.n]))

  return reviewers.map((r) => ({
    user_id: r.user_id,
    full_name: r.full_name,
    email: r.email,
    has_conflict: conflictIds.has(r.user_id),
    already_assigned: assignedIds.has(r.user_id),
    is_author_of_submission: authorUserIds.has(r.user_id) || authorEmails.has(r.email.toLowerCase()) || r.user_id === sub.created_by,
    track_match: trackMatchIds.has(r.user_id),
    open_assignment_count: loadByReviewer.get(r.user_id) ?? 0,
  }))
}

export async function assignReviewer(
  actorUserId: string,
  conferenceId: string,
  submissionId: string,
  input: AssignReviewerInput,
): Promise<{ id: string }> {
  await assertConferencePermission(actorUserId, conferenceId, 'review.assign')

  const dueAt = new Date(input.due_at)
  if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
    throw new BadRequestError('Choose a due date in the future.', { due_at: 'Choose a date in the future.' })
  }

  return withTransaction(actorUserId, async (conn) => {
    const [subRows] = await conn.query(
      `SELECT id, status, current_round, created_by FROM submissions
       WHERE id = ? AND conference_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [submissionId, conferenceId],
    )
    const sub = (subRows as Array<{ id: string; status: string; current_round: number; created_by: string }>)[0]
    if (!sub) throw new NotFoundError('This submission does not exist.')

    const [reviewerRows] = await conn.query(
      `SELECT u.full_name, u.email FROM conference_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.conference_id = ? AND cm.user_id = ? AND cm.role_code = 'reviewer' AND cm.status = 'active' LIMIT 1`,
      [conferenceId, input.reviewer_id],
    )
    const reviewer = (reviewerRows as Array<{ full_name: string; email: string }>)[0]
    if (!reviewer) throw new BadRequestError('This person is not an active reviewer of this conference.')

    const [authorRows] = await conn.query(
      `SELECT user_id, email FROM submission_authors WHERE submission_id = ?`,
      [submissionId],
    )
    const authors = authorRows as Array<{ user_id: string | null; email: string }>
    const isAuthor =
      sub.created_by === input.reviewer_id ||
      authors.some((a) => a.user_id === input.reviewer_id || a.email.toLowerCase() === reviewer.email.toLowerCase())
    if (isAuthor) {
      throw new BadRequestError('This person is an author of this submission and cannot review it.')
    }

    const [conflictRows] = await conn.query(
      `SELECT 1 FROM conflicts_of_interest WHERE submission_id = ? AND user_id = ? LIMIT 1`,
      [submissionId, input.reviewer_id],
    )
    if ((conflictRows as unknown[]).length > 0) {
      throw new BadRequestError('This reviewer has a declared conflict of interest with this submission.')
    }

    try {
      await conn.query(
        `INSERT INTO review_assignments (conference_id, submission_id, reviewer_id, round, assigned_by, due_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conferenceId, submissionId, input.reviewer_id, sub.current_round, actorUserId, dueAt],
      )
    } catch (err) {
      if (err && typeof err === 'object' && (err as { errno?: number }).errno === 1062) {
        throw new ConflictError('This reviewer is already assigned to this submission for this round.')
      }
      throw err
    }
    const [idRows] = await conn.query(
      `SELECT id FROM review_assignments WHERE submission_id = ? AND reviewer_id = ? AND round = ? LIMIT 1`,
      [submissionId, input.reviewer_id, sub.current_round],
    )
    const id = (idRows as Array<{ id: string }>)[0]!.id

    if (sub.status === 'submitted') {
      try {
        await conn.query(`UPDATE submissions SET status = 'under_review' WHERE id = ?`, [submissionId])
      } catch (err) {
        mapDatabaseError(err)
      }
    }

    const [templateRows] = await conn.query(
      `SELECT subject, body_html FROM email_templates WHERE conference_id IS NULL AND template_key = 'review_assigned' LIMIT 1`,
    )
    const template = (templateRows as Array<{ subject: string }>)[0]
    const [titleRows] = await conn.query(`SELECT title, submission_code FROM submissions WHERE id = ? LIMIT 1`, [submissionId])
    const titleRow = (titleRows as Array<{ title: string; submission_code: string | null }>)[0]!
    const data = {
      full_name: reviewer.full_name,
      due_at: dueAt.toISOString(),
      submission_code: titleRow.submission_code ?? '',
      title: titleRow.title,
    }
    const subject = template ? renderTemplate(template.subject, data) : 'New review assignment'
    await queueEmail(conn, {
      userId: input.reviewer_id,
      conferenceId,
      recipientEmail: reviewer.email,
      templateKey: 'review_assigned',
      subject,
      templateData: data,
      entityType: 'review_assignments',
      entityId: id,
    })
    await notifyUser(conn, {
      userId: input.reviewer_id,
      conferenceId,
      type: 'review',
      title: 'New review assignment',
      body: `You've been asked to review "${titleRow.title}" (${titleRow.submission_code ?? ''}), due ${dueAt.toLocaleDateString()}.`,
      linkPath: '/reviewer',
      entityType: 'review_assignments',
      entityId: id,
    })

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'review.assign',
      entityType: 'review_assignments',
      entityId: id,
      newValues: { submission_id: submissionId, reviewer_id: input.reviewer_id, due_at: dueAt.toISOString() },
    })
    return { id }
  })
}

export async function cancelAssignment(
  actorUserId: string,
  conferenceId: string,
  assignmentId: string,
  reason: string,
): Promise<void> {
  await assertConferencePermission(actorUserId, conferenceId, 'review.assign')
  await withTransaction(actorUserId, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, status FROM review_assignments WHERE id = ? AND conference_id = ? LIMIT 1 FOR UPDATE`,
      [assignmentId, conferenceId],
    )
    const row = (rows as Array<{ id: string; status: string }>)[0]
    if (!row) throw new NotFoundError('This assignment does not exist.')
    if (row.status === 'completed') {
      throw new ConflictError('Cannot cancel a completed review.')
    }
    await conn.query(`UPDATE review_assignments SET status = 'cancelled', cancel_reason = ? WHERE id = ?`, [reason, assignmentId])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'review.cancel_assignment',
      entityType: 'review_assignments',
      entityId: assignmentId,
      newValues: { reason },
    })
  })
}

export async function addConflict(actorUserId: string, conferenceId: string, input: AddConflictInput): Promise<{ id: string }> {
  await assertConferencePermission(actorUserId, conferenceId, 'review.assign')
  return withTransaction(actorUserId, async (conn) => {
    await loadSubmissionInConference(input.submission_id, conferenceId, conn)
    try {
      await conn.query(
        `INSERT INTO conflicts_of_interest (submission_id, user_id, source, reason, created_by)
         VALUES (?, ?, 'manager_flagged', ?, ?)`,
        [input.submission_id, input.user_id, input.reason ?? null, actorUserId],
      )
    } catch (err) {
      if (err && typeof err === 'object' && (err as { errno?: number }).errno === 1062) {
        throw new ConflictError('A conflict is already recorded for this person on this submission.')
      }
      throw err
    }
    const [idRows] = await conn.query(
      `SELECT id FROM conflicts_of_interest WHERE submission_id = ? AND user_id = ? LIMIT 1`,
      [input.submission_id, input.user_id],
    )
    const id = (idRows as Array<{ id: string }>)[0]!.id
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'review.conflict.add',
      entityType: 'conflicts_of_interest',
      entityId: id,
      newValues: input,
    })
    return { id }
  })
}

// ---------------------------------------------------------------------------
// B4. Decisions
// ---------------------------------------------------------------------------

const STAGE_REQUIRED_STATUSES: Record<string, string[]> = {
  abstract: ['submitted', 'under_review'],
  full_paper: ['full_paper_submitted'],
  final_approval: ['full_paper_submitted'],
}

function computeDecisionStatus(stage: string, decision: string): string {
  if (decision === 'rejected') return 'rejected'
  if (decision === 'revision_required') return 'revision_required'
  // accepted
  return stage === 'abstract' ? 'accepted' : 'final_approved'
}

export async function recordDecision(
  actorUserId: string,
  conferenceId: string,
  submissionId: string,
  input: DecisionInput,
): Promise<void> {
  await assertConferencePermission(actorUserId, conferenceId, 'decision.make')

  await withTransaction(actorUserId, async (conn) => {
    const [subRows] = await conn.query(
      `SELECT id, status, current_round, created_by FROM submissions
       WHERE id = ? AND conference_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [submissionId, conferenceId],
    )
    const sub = (subRows as Array<{ id: string; status: string; current_round: number; created_by: string }>)[0]
    if (!sub) throw new NotFoundError('This submission does not exist.')

    const allowedStatuses = STAGE_REQUIRED_STATUSES[input.stage] ?? []
    if (!allowedStatuses.includes(sub.status)) {
      throw new ConflictError(`A ${input.stage.replace('_', ' ')} decision cannot be recorded from status "${sub.status}".`)
    }

    try {
      await conn.query(
        `INSERT INTO submission_decisions (submission_id, stage, round, decision, decided_by, comments_to_author, internal_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [submissionId, input.stage, sub.current_round, input.decision, actorUserId, input.comments_to_author ?? null, input.internal_notes ?? null],
      )
    } catch (err) {
      if (err && typeof err === 'object' && (err as { errno?: number }).errno === 1062) {
        throw new ConflictError('A decision for this stage and round has already been recorded.')
      }
      throw err
    }
    const [decisionIdRows] = await conn.query(
      `SELECT id FROM submission_decisions WHERE submission_id = ? AND stage = ? AND round = ? LIMIT 1`,
      [submissionId, input.stage, sub.current_round],
    )
    const decisionId = (decisionIdRows as Array<{ id: string }>)[0]!.id

    const newStatus = computeDecisionStatus(input.stage, input.decision)
    try {
      await conn.query(`UPDATE submissions SET status = ? WHERE id = ?`, [newStatus, submissionId])
    } catch (err) {
      mapDatabaseError(err)
    }

    if (input.decision !== 'revision_required') {
      await conn.query(
        `UPDATE review_assignments SET status = 'cancelled', cancel_reason = 'Decision recorded'
         WHERE submission_id = ? AND round = ? AND status IN ('assigned', 'in_progress')`,
        [submissionId, sub.current_round],
      )
    }

    const [correspondingRows] = await conn.query(
      `SELECT full_name, email, user_id FROM submission_authors WHERE submission_id = ? AND is_corresponding = TRUE LIMIT 1`,
      [submissionId],
    )
    const corresponding = (correspondingRows as Array<{ full_name: string; email: string; user_id: string | null }>)[0]
    if (corresponding) {
      const templateKey =
        input.decision === 'accepted'
          ? 'decision_accepted'
          : input.decision === 'rejected'
            ? 'decision_rejected'
            : 'decision_revision_required'
      const [templateRows] = await conn.query(
        `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = ? LIMIT 1`,
        [templateKey],
      )
      const template = (templateRows as Array<{ subject: string }>)[0]
      const [titleRows] = await conn.query(`SELECT title, submission_code FROM submissions WHERE id = ? LIMIT 1`, [submissionId])
      const titleRow = (titleRows as Array<{ title: string; submission_code: string | null }>)[0]!
      const data = { full_name: corresponding.full_name, title: titleRow.title, submission_code: titleRow.submission_code ?? '' }
      const subject = template ? renderTemplate(template.subject, data) : `Decision on ${titleRow.title}`
      await queueEmail(conn, {
        userId: sub.created_by,
        conferenceId,
        recipientEmail: corresponding.email,
        templateKey,
        subject,
        templateData: data,
        entityType: 'submission_decisions',
        entityId: decisionId,
      })
      await conn.query(`UPDATE submission_decisions SET notified_at = NOW(3) WHERE id = ?`, [decisionId])

      if (corresponding.user_id) {
        const decisionLabel =
          input.decision === 'accepted' ? 'accepted' : input.decision === 'rejected' ? 'rejected' : 'sent back for revision'
        await notifyUser(conn, {
          userId: corresponding.user_id,
          conferenceId,
          type: input.decision === 'accepted' ? 'acceptance' : input.decision === 'rejected' ? 'rejection' : 'review',
          title: 'Decision recorded',
          body: `"${titleRow.title}" (${titleRow.submission_code ?? ''}) was ${decisionLabel}.`,
          linkPath: '/author',
          entityType: 'submission_decisions',
          entityId: decisionId,
        })
      }
    }

    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: 'review.decision.record',
      entityType: 'submission_decisions',
      entityId: decisionId,
      newValues: input,
    })
  })
}

// ---------------------------------------------------------------------------
// B3. Reviewer portal
// ---------------------------------------------------------------------------

export type MyAssignmentRow = {
  id: string
  submission_id: string
  submission_code: string | null
  title: string
  track_name: string
  due_at: string
  status: string
  is_overdue: number | boolean
}

export async function listMyAssignments(userId: string, conferenceId?: string): Promise<MyAssignmentRow[]> {
  const params: unknown[] = [userId]
  let conferenceClause = ''
  if (conferenceId) {
    conferenceClause = 'AND ra.conference_id = ?'
    params.push(conferenceId)
  }
  const [rows] = await pool.query(
    `SELECT ra.id, s.id AS submission_id, s.submission_code, s.title, t.name AS track_name, ra.due_at, ra.status,
            (ra.due_at < NOW(3) AND ra.status IN ('assigned', 'in_progress')) AS is_overdue
     FROM review_assignments ra
     JOIN submissions s ON s.id = ra.submission_id
     JOIN conference_tracks t ON t.id = s.track_id
     WHERE ra.reviewer_id = ? ${conferenceClause}
     ORDER BY ra.due_at`,
    params,
  )
  return (rows as MyAssignmentRow[]).map((r) => ({ ...r, is_overdue: Boolean(r.is_overdue) }))
}

async function loadOwnAssignment(
  conn: PoolConnection | typeof pool,
  userId: string,
  assignmentId: string,
  forUpdate = false,
): Promise<{ id: string; submission_id: string; reviewer_id: string; status: string }> {
  const [rows] = await conn.query(
    `SELECT id, submission_id, reviewer_id, status FROM review_assignments WHERE id = ? AND reviewer_id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [assignmentId, userId],
  )
  const row = (rows as Array<{ id: string; submission_id: string; reviewer_id: string; status: string }>)[0]
  if (!row) throw new NotFoundError('This assignment does not exist.')
  return row
}

export async function acceptAssignment(userId: string, assignmentId: string): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const assignment = await loadOwnAssignment(conn, userId, assignmentId, true)
    if (assignment.status !== 'assigned') {
      throw new ConflictError('This assignment cannot be accepted from its current status.')
    }
    await conn.query(`UPDATE review_assignments SET status = 'in_progress', responded_at = NOW(3) WHERE id = ?`, [assignmentId])
    await insertAuditLog(conn, {
      actorUserId: userId,
      action: 'review.assignment.accept',
      entityType: 'review_assignments',
      entityId: assignmentId,
    })
  })
}

export async function declineAssignment(userId: string, assignmentId: string, reason?: string): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const assignment = await loadOwnAssignment(conn, userId, assignmentId, true)
    if (assignment.status !== 'assigned' && assignment.status !== 'in_progress') {
      throw new ConflictError('This assignment cannot be declined from its current status.')
    }
    await conn.query(
      `UPDATE review_assignments SET status = 'declined', cancel_reason = ?, responded_at = COALESCE(responded_at, NOW(3)) WHERE id = ?`,
      [reason ?? null, assignmentId],
    )
    await insertAuditLog(conn, {
      actorUserId: userId,
      action: 'review.assignment.decline',
      entityType: 'review_assignments',
      entityId: assignmentId,
      newValues: { reason: reason ?? null },
    })
  })
}

export async function declareConflictAndDecline(userId: string, assignmentId: string, reason?: string): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const assignment = await loadOwnAssignment(conn, userId, assignmentId, true)
    if (assignment.status !== 'assigned' && assignment.status !== 'in_progress') {
      throw new ConflictError('This assignment cannot be declined from its current status.')
    }

    try {
      await conn.query(
        `INSERT INTO conflicts_of_interest (submission_id, user_id, source, reason, created_by)
         VALUES (?, ?, 'reviewer_declared', ?, ?)`,
        [assignment.submission_id, userId, reason ?? null, userId],
      )
    } catch (err) {
      if (!(err && typeof err === 'object' && (err as { errno?: number }).errno === 1062)) {
        throw err
      }
    }

    await conn.query(
      `UPDATE review_assignments SET status = 'declined', cancel_reason = ?, responded_at = COALESCE(responded_at, NOW(3)) WHERE id = ?`,
      [reason ?? 'Conflict of interest declared.', assignmentId],
    )
    await insertAuditLog(conn, {
      actorUserId: userId,
      action: 'review.assignment.conflict',
      entityType: 'review_assignments',
      entityId: assignmentId,
      newValues: { reason: reason ?? null },
    })
  })
}

export async function getAssignmentDetail(userId: string, assignmentId: string) {
  const assignment = await loadOwnAssignment(pool, userId, assignmentId)

  const [subRows] = await pool.query(
    `SELECT s.id, s.title, s.abstract, s.keywords, s.track_id, t.name AS track_name, c.review_mode
     FROM submissions s
     JOIN conference_tracks t ON t.id = s.track_id
     JOIN conferences conf ON conf.id = s.conference_id
     LEFT JOIN conference_settings c ON c.conference_id = s.conference_id
     WHERE s.id = ? LIMIT 1`,
    [assignment.submission_id],
  )
  const sub = (subRows as Array<Record<string, unknown>>)[0]
  if (!sub) throw new NotFoundError('This submission does not exist.')
  const reviewMode = (sub.review_mode as string | null) ?? 'double_blind'

  const [fileRows] = await pool.query(
    `SELECT id, file_kind, version, original_filename, mime_type, size_bytes FROM submission_files
     WHERE submission_id = ? AND status = 'active' ORDER BY file_kind`,
    [assignment.submission_id],
  )

  let authors: unknown[] = []
  if (reviewMode === 'open') {
    const [authorRows] = await pool.query(
      `SELECT full_name, email, affiliation, country FROM submission_authors WHERE submission_id = ? ORDER BY author_order`,
      [assignment.submission_id],
    )
    authors = authorRows as unknown[]
  }

  const [reviewRows] = await pool.query(`SELECT * FROM reviews WHERE assignment_id = ? LIMIT 1`, [assignmentId])
  const review = (reviewRows as unknown[])[0] ?? null

  return {
    assignment: { id: assignment.id, status: assignment.status },
    submission: { id: sub.id, title: sub.title, abstract: sub.abstract, keywords: sub.keywords, track_name: sub.track_name },
    review_mode: reviewMode,
    authors,
    files: fileRows,
    review,
  }
}

export async function saveReviewDraft(userId: string, assignmentId: string, input: SaveReviewDraftInput): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const assignment = await loadOwnAssignment(conn, userId, assignmentId, true)
    if (assignment.status !== 'in_progress') {
      throw new ConflictError('Accept this assignment before writing a review.')
    }
    const [subRows] = await conn.query(
      `SELECT status FROM submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [assignment.submission_id],
    )
    const sub = (subRows as Array<{ status: string }>)[0]
    if (!sub || sub.status === 'withdrawn') {
      throw new ConflictError('This submission is no longer available for review.')
    }

    try {
      await conn.query(
        `INSERT INTO reviews
           (assignment_id, originality, quality, relevance, methodology, overall_score, confidence, recommendation, comments_to_author, confidential_comments, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
         ON DUPLICATE KEY UPDATE
           originality = VALUES(originality), quality = VALUES(quality), relevance = VALUES(relevance),
           methodology = VALUES(methodology), overall_score = VALUES(overall_score), confidence = VALUES(confidence),
           recommendation = VALUES(recommendation), comments_to_author = VALUES(comments_to_author),
           confidential_comments = VALUES(confidential_comments)`,
        [
          assignmentId,
          input.originality ?? null,
          input.quality ?? null,
          input.relevance ?? null,
          input.methodology ?? null,
          input.overall_score ?? null,
          input.confidence ?? null,
          input.recommendation ?? null,
          input.comments_to_author ?? null,
          input.confidential_comments ?? null,
        ],
      )
    } catch (err) {
      mapDatabaseError(err)
    }
  })
}

export async function submitReview(userId: string, assignmentId: string, input: SubmitReviewInput): Promise<void> {
  await withTransaction(userId, async (conn) => {
    const assignment = await loadOwnAssignment(conn, userId, assignmentId, true)
    if (assignment.status !== 'in_progress') {
      throw new ConflictError('Accept this assignment before submitting a review.')
    }
    const [subRows] = await conn.query(
      `SELECT status, conference_id, title, submission_code FROM submissions WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [assignment.submission_id],
    )
    const sub = (subRows as Array<{ status: string; conference_id: string; title: string; submission_code: string | null }>)[0]
    if (!sub || sub.status === 'withdrawn') {
      throw new ConflictError('This submission is no longer available for review.')
    }

    try {
      await conn.query(
        `INSERT INTO reviews
           (assignment_id, originality, quality, relevance, methodology, overall_score, confidence, recommendation, comments_to_author, confidential_comments, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
         ON DUPLICATE KEY UPDATE
           originality = VALUES(originality), quality = VALUES(quality), relevance = VALUES(relevance),
           methodology = VALUES(methodology), overall_score = VALUES(overall_score), confidence = VALUES(confidence),
           recommendation = VALUES(recommendation), comments_to_author = VALUES(comments_to_author),
           confidential_comments = VALUES(confidential_comments), status = 'submitted'`,
        [
          assignmentId,
          input.originality,
          input.quality,
          input.relevance,
          input.methodology,
          input.overall_score,
          input.confidence,
          input.recommendation,
          input.comments_to_author,
          input.confidential_comments ?? null,
        ],
      )
    } catch (err) {
      mapDatabaseError(err)
    }

    await conn.query(`UPDATE review_assignments SET status = 'completed', completed_at = NOW(3) WHERE id = ?`, [assignmentId])

    const [convenorRows] = await conn.query(
      `SELECT user_id FROM conference_members WHERE conference_id = ? AND role_code = 'convenor' AND status = 'active' LIMIT 1`,
      [sub.conference_id],
    )
    const convenorId = (convenorRows as Array<{ user_id: string }>)[0]?.user_id
    if (convenorId) {
      await notifyUser(conn, {
        userId: convenorId,
        conferenceId: sub.conference_id,
        type: 'review',
        title: 'Review submitted',
        body: `A review was submitted for "${sub.title}" (${sub.submission_code ?? ''}).`,
        linkPath: '/convenor',
        entityType: 'review_assignments',
        entityId: assignmentId,
      })
    }

    await insertAuditLog(conn, {
      actorUserId: userId,
      action: 'review.submit',
      entityType: 'review_assignments',
      entityId: assignmentId,
    })
  })
}
