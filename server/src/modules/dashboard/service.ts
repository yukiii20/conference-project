import { pool } from '../../db/pool.js'

const ACCEPTED_STATUSES = [
  'accepted',
  'full_paper_pending',
  'full_paper_submitted',
  'final_approved',
  'scheduled',
  'presented',
  'completed',
] as const

export type DashboardData = {
  submissions_by_status: Record<string, number>
  reviews: { assigned: number; completed: number }
  accepted_papers: number
  members_by_role: Record<string, number>
  registrations: number
  next_key_date: { deadline_type: string; at: string; days: number } | null
  submissions_per_track: Array<{ track_name: string; count: number }>
  needs_attention: {
    pending_role_requests: number
    submitted_no_reviewer: number
    overdue_reviews: number
    awaiting_decision: number
    deadline_within_week: { deadline_type: string; at: string; days: number } | null
  }
}

export async function getDashboard(conferenceId: string): Promise<DashboardData> {
  const [statusRows] = await pool.query(
    `SELECT status, COUNT(*) AS count FROM submissions
     WHERE conference_id = ? AND deleted_at IS NULL GROUP BY status`,
    [conferenceId],
  )
  const submissions_by_status: Record<string, number> = {}
  for (const row of statusRows as Array<{ status: string; count: number }>) {
    submissions_by_status[row.status] = Number(row.count)
  }

  const [reviewRows] = await pool.query(
    `SELECT
       SUM(CASE WHEN status IN ('assigned', 'in_progress') THEN 1 ELSE 0 END) AS assigned,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM review_assignments WHERE conference_id = ?`,
    [conferenceId],
  )
  const reviewRow = (reviewRows as Array<{ assigned: number | null; completed: number | null }>)[0]
  const reviews = { assigned: Number(reviewRow?.assigned ?? 0), completed: Number(reviewRow?.completed ?? 0) }

  const accepted_papers = ACCEPTED_STATUSES.reduce((sum, s) => sum + (submissions_by_status[s] ?? 0), 0)

  const [memberRows] = await pool.query(
    `SELECT role_code, COUNT(*) AS count FROM conference_members
     WHERE conference_id = ? AND status = 'active' GROUP BY role_code`,
    [conferenceId],
  )
  const members_by_role: Record<string, number> = {}
  for (const row of memberRows as Array<{ role_code: string; count: number }>) {
    members_by_role[row.role_code] = Number(row.count)
  }

  const [deadlineRows] = await pool.query(
    `SELECT deadline_type, COALESCE(closes_at, opens_at) AS at
     FROM conference_deadlines
     WHERE conference_id = ? AND COALESCE(closes_at, opens_at) >= NOW(3)
     ORDER BY at ASC LIMIT 1`,
    [conferenceId],
  )
  const deadlineRow = (deadlineRows as Array<{ deadline_type: string; at: string }>)[0]
  const next_key_date = deadlineRow
    ? {
        deadline_type: deadlineRow.deadline_type,
        at: deadlineRow.at,
        days: Math.ceil((new Date(deadlineRow.at).getTime() - Date.now()) / 86_400_000),
      }
    : null

  const [trackRows] = await pool.query(
    `SELECT t.name AS track_name, COUNT(s.id) AS count
     FROM conference_tracks t
     LEFT JOIN submissions s ON s.track_id = t.id AND s.deleted_at IS NULL AND s.status <> 'draft'
     WHERE t.conference_id = ?
     GROUP BY t.id, t.name ORDER BY t.display_order`,
    [conferenceId],
  )
  const submissions_per_track = (trackRows as Array<{ track_name: string; count: number }>).map((r) => ({
    track_name: r.track_name,
    count: Number(r.count),
  }))

  const [pendingRows] = await pool.query(
    `SELECT COUNT(*) AS count FROM role_requests WHERE conference_id = ? AND status = 'pending'`,
    [conferenceId],
  )
  const pending_role_requests = Number((pendingRows as Array<{ count: number }>)[0]?.count ?? 0)

  const [noReviewerRows] = await pool.query(
    `SELECT COUNT(*) AS count FROM submissions s
     WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status = 'submitted'
       AND NOT EXISTS (
         SELECT 1 FROM review_assignments ra
         WHERE ra.submission_id = s.id AND ra.round = s.current_round
           AND ra.status IN ('assigned', 'in_progress', 'completed')
       )`,
    [conferenceId],
  )
  const submitted_no_reviewer = Number((noReviewerRows as Array<{ count: number }>)[0]?.count ?? 0)

  const [overdueRows] = await pool.query(
    `SELECT COUNT(*) AS count FROM review_assignments
     WHERE conference_id = ? AND status IN ('assigned', 'in_progress') AND due_at < NOW(3)`,
    [conferenceId],
  )
  const overdue_reviews = Number((overdueRows as Array<{ count: number }>)[0]?.count ?? 0)

  const [awaitingRows] = await pool.query(
    `SELECT COUNT(*) AS count FROM submissions s
     JOIN conference_settings cs ON cs.conference_id = s.conference_id
     WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status = 'under_review'
       AND (SELECT COUNT(*) FROM review_assignments ra
            WHERE ra.submission_id = s.id AND ra.round = s.current_round AND ra.status = 'completed') >= cs.reviews_required
       AND NOT EXISTS (
         SELECT 1 FROM submission_decisions sd
         WHERE sd.submission_id = s.id AND sd.stage = 'abstract' AND sd.round = s.current_round
       )`,
    [conferenceId],
  )
  const awaiting_decision = Number((awaitingRows as Array<{ count: number }>)[0]?.count ?? 0)

  return {
    submissions_by_status,
    reviews,
    accepted_papers,
    members_by_role,
    registrations: 0,
    next_key_date,
    submissions_per_track,
    needs_attention: {
      pending_role_requests,
      submitted_no_reviewer,
      overdue_reviews,
      awaiting_decision,
      deadline_within_week: next_key_date && next_key_date.days <= 7 && next_key_date.days >= 0 ? next_key_date : null,
    },
  }
}
