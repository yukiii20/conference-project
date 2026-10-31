// Response shapes for the endpoints the convenor dashboard reads. These mirror
// the server (server/src/modules/dashboard, analytics, deadlines, schedule,
// activityLog) - no fields are invented here.

export type Dashboard = {
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

type DailyPoint = { date: string; count: number }
type RateStat = { numerator: number; denominator: number; rate: number }

export type ConvenorAnalytics = {
  range: { from: string; to: string }
  submissions_per_day: DailyPoint[]
  submissions_per_track: Array<{ name: string; count: number }>
  acceptance_rate: RateStat
  review_progress: { assigned: number; submitted: number; overdue: number }
  registrations_over_time: DailyPoint[]
  registrations_by_category: Array<{ name: string; count: number }>
  attendance_rate: RateStat
}

export type DeadlineRow = {
  code: string
  name: string
  is_window: boolean
  opens_at: string | null
  closes_at: string | null
}

export type SessionRow = {
  id: string
  title: string
  session_type: string
  room_id: string
  starts_at: string
  ends_at: string
  status: string
}

export type Room = { id: string; name: string }

export type ActivityEntry = {
  id: number
  occurred_at: string
  actor_name: string | null
  action: string
  entity_type: string
}
