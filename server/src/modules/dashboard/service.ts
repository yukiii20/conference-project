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
    pending_registrations: number
    deadline_within_week: { deadline_type: string; at: string; days: number } | null
  }
  setup_checklist: {
    details_done: boolean
    logo_done: boolean
    key_dates_done: boolean
    tracks_done: boolean
    registration_categories_done: boolean
    certificate_template_done: boolean
    published: boolean
  }
}

export async function getDashboard(conferenceId: string): Promise<DashboardData> {
  // All independent (no query depends on another's result) - run them
  // concurrently over the pool instead of paying one sequential round trip
  // per query. The last six feed the "Setup checklist" card and the
  // "Pending registrations" attention item - cheap existence/count checks,
  // not worth a separate round trip (or a separate page load) apiece.
  const [
    [statusRows],
    [reviewRows],
    [memberRows],
    [deadlineRows],
    [trackRows],
    [pendingRows],
    [noReviewerRows],
    [overdueRows],
    [awaitingRows],
    [registrationRows],
    [conferenceRows],
    [deadlineCountRows],
    [trackCountRows],
    [categoryCountRows],
    [certificateCountRows],
    [pendingRegistrationRows],
  ] = await Promise.all([
    pool.query(
      `SELECT status, COUNT(*) AS count FROM submissions
       WHERE conference_id = ? AND deleted_at IS NULL GROUP BY status`,
      [conferenceId],
    ),
    pool.query(
      `SELECT
         SUM(CASE WHEN status IN ('assigned', 'in_progress') THEN 1 ELSE 0 END) AS assigned,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM review_assignments WHERE conference_id = ?`,
      [conferenceId],
    ),
    pool.query(
      `SELECT role_code, COUNT(*) AS count FROM conference_members
       WHERE conference_id = ? AND status = 'active' GROUP BY role_code`,
      [conferenceId],
    ),
    pool.query(
      `SELECT deadline_type, COALESCE(closes_at, opens_at) AS at
       FROM conference_deadlines
       WHERE conference_id = ? AND COALESCE(closes_at, opens_at) >= NOW(3)
       ORDER BY at ASC LIMIT 1`,
      [conferenceId],
    ),
    pool.query(
      `SELECT t.name AS track_name, COUNT(s.id) AS count
       FROM conference_tracks t
       LEFT JOIN submissions s ON s.track_id = t.id AND s.deleted_at IS NULL AND s.status <> 'draft'
       WHERE t.conference_id = ?
       GROUP BY t.id, t.name ORDER BY t.display_order`,
      [conferenceId],
    ),
    pool.query(`SELECT COUNT(*) AS count FROM role_requests WHERE conference_id = ? AND status = 'pending'`, [
      conferenceId,
    ]),
    pool.query(
      `SELECT COUNT(*) AS count FROM submissions s
       WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status = 'submitted'
         AND NOT EXISTS (
           SELECT 1 FROM review_assignments ra
           WHERE ra.submission_id = s.id AND ra.round = s.current_round
             AND ra.status IN ('assigned', 'in_progress', 'completed')
         )`,
      [conferenceId],
    ),
    pool.query(
      `SELECT COUNT(*) AS count FROM review_assignments
       WHERE conference_id = ? AND status IN ('assigned', 'in_progress') AND due_at < NOW(3)`,
      [conferenceId],
    ),
    pool.query(
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
    ),
    pool.query(`SELECT COUNT(*) AS count FROM registrations WHERE conference_id = ? AND status <> 'cancelled'`, [
      conferenceId,
    ]),
    pool.query(`SELECT description, logo_path, status FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [
      conferenceId,
    ]),
    pool.query(`SELECT COUNT(*) AS count FROM conference_deadlines WHERE conference_id = ?`, [conferenceId]),
    pool.query(`SELECT COUNT(*) AS count FROM conference_tracks WHERE conference_id = ?`, [conferenceId]),
    pool.query(`SELECT COUNT(*) AS count FROM registration_categories WHERE conference_id = ?`, [conferenceId]),
    pool.query(`SELECT COUNT(*) AS count FROM certificate_templates WHERE conference_id = ?`, [conferenceId]),
    pool.query(`SELECT COUNT(*) AS count FROM registrations WHERE conference_id = ? AND status = 'pending'`, [
      conferenceId,
    ]),
  ])

  const submissions_by_status: Record<string, number> = {}
  for (const row of statusRows as Array<{ status: string; count: number }>) {
    submissions_by_status[row.status] = Number(row.count)
  }

  const reviewRow = (reviewRows as Array<{ assigned: number | null; completed: number | null }>)[0]
  const reviews = { assigned: Number(reviewRow?.assigned ?? 0), completed: Number(reviewRow?.completed ?? 0) }

  const accepted_papers = ACCEPTED_STATUSES.reduce((sum, s) => sum + (submissions_by_status[s] ?? 0), 0)

  const members_by_role: Record<string, number> = {}
  for (const row of memberRows as Array<{ role_code: string; count: number }>) {
    members_by_role[row.role_code] = Number(row.count)
  }

  const deadlineRow = (deadlineRows as Array<{ deadline_type: string; at: string }>)[0]
  const next_key_date = deadlineRow
    ? {
        deadline_type: deadlineRow.deadline_type,
        at: deadlineRow.at,
        days: Math.ceil((new Date(deadlineRow.at).getTime() - Date.now()) / 86_400_000),
      }
    : null

  const submissions_per_track = (trackRows as Array<{ track_name: string; count: number }>).map((r) => ({
    track_name: r.track_name,
    count: Number(r.count),
  }))

  const pending_role_requests = Number((pendingRows as Array<{ count: number }>)[0]?.count ?? 0)
  const submitted_no_reviewer = Number((noReviewerRows as Array<{ count: number }>)[0]?.count ?? 0)
  const overdue_reviews = Number((overdueRows as Array<{ count: number }>)[0]?.count ?? 0)
  const awaiting_decision = Number((awaitingRows as Array<{ count: number }>)[0]?.count ?? 0)
  const registrations = Number((registrationRows as Array<{ count: number }>)[0]?.count ?? 0)

  const conferenceRow = (conferenceRows as Array<{ description: string | null; logo_path: string | null; status: string }>)[0]
  const pending_registrations = Number((pendingRegistrationRows as Array<{ count: number }>)[0]?.count ?? 0)

  return {
    submissions_by_status,
    reviews,
    accepted_papers,
    members_by_role,
    registrations,
    next_key_date,
    submissions_per_track,
    needs_attention: {
      pending_role_requests,
      submitted_no_reviewer,
      overdue_reviews,
      awaiting_decision,
      pending_registrations,
      deadline_within_week: next_key_date && next_key_date.days <= 7 && next_key_date.days >= 0 ? next_key_date : null,
    },
    setup_checklist: {
      details_done: Boolean(conferenceRow?.description && conferenceRow.description.trim() !== ''),
      logo_done: Boolean(conferenceRow?.logo_path),
      key_dates_done: Number((deadlineCountRows as Array<{ count: number }>)[0]?.count ?? 0) > 0,
      tracks_done: Number((trackCountRows as Array<{ count: number }>)[0]?.count ?? 0) > 0,
      registration_categories_done: Number((categoryCountRows as Array<{ count: number }>)[0]?.count ?? 0) > 0,
      certificate_template_done: Number((certificateCountRows as Array<{ count: number }>)[0]?.count ?? 0) > 0,
      published: conferenceRow?.status !== 'draft',
    },
  }
}
