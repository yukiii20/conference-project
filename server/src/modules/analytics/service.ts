import { pool } from '../../db/pool.js'
import { localDateKey, localDateRangeToUtc } from '../../utils/timezone.js'
import { NotFoundError } from '../../utils/errors.js'

type DateRange = { from: string; to: string }

/** Defaults to the last 30 days (inclusive) when the caller doesn't pick a range. */
function resolveRange(input: Partial<DateRange>): DateRange {
  const to = input.to ?? new Date().toISOString().slice(0, 10)
  const from = input.from ?? new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10)
  return { from, to }
}

async function loadConference(conferenceId: string): Promise<{ timezone: string; code: string; startDate: string; endDate: string }> {
  const [rows] = await pool.query(
    'SELECT timezone, code, start_date, end_date FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [conferenceId],
  )
  const row = (rows as Array<{ timezone: string; code: string; start_date: string; end_date: string }>)[0]
  if (!row) throw new NotFoundError('This conference does not exist.')
  return { timezone: row.timezone, code: row.code, startDate: row.start_date, endDate: row.end_date }
}

export type DailyPoint = { date: string; count: number }
export type NamedCount = { name: string; count: number }

/** One row per day in [from, to] even if the count is 0 — a line chart must never silently skip a day. */
function fillDailySeries(from: string, to: string, countsByDate: Map<string, number>): DailyPoint[] {
  const points: DailyPoint[] = []
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10)
    points.push({ date, count: countsByDate.get(date) ?? 0 })
  }
  return points
}

async function submissionsPerDay(conferenceId: string, timezone: string, range: DateRange): Promise<DailyPoint[]> {
  const { startUtc, endUtc } = localDateRangeToUtc(range.from, range.to, timezone)
  const [rows] = await pool.query(
    `SELECT submitted_at FROM submissions
     WHERE conference_id = ? AND deleted_at IS NULL AND submitted_at BETWEEN ? AND ?`,
    [conferenceId, startUtc, endUtc],
  )
  const counts = new Map<string, number>()
  for (const row of rows as Array<{ submitted_at: string }>) {
    const key = localDateKey(timezone, new Date(row.submitted_at))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return fillDailySeries(range.from, range.to, counts)
}

async function submissionsPerTrack(conferenceId: string): Promise<NamedCount[]> {
  const [rows] = await pool.query(
    `SELECT t.name AS name, COUNT(s.id) AS count
     FROM conference_tracks t
     LEFT JOIN submissions s ON s.track_id = t.id AND s.deleted_at IS NULL AND s.status <> 'draft'
     WHERE t.conference_id = ?
     GROUP BY t.id, t.name
     ORDER BY t.display_order, t.name`,
    [conferenceId],
  )
  return (rows as Array<{ name: string; count: number }>).map((r) => ({ name: r.name, count: Number(r.count) }))
}

export type RateStat = { numerator: number; denominator: number; rate: number }

async function acceptanceRate(conferenceId: string): Promise<RateStat> {
  const [rows] = await pool.query(
    `SELECT sd.decision, COUNT(*) AS count
     FROM submission_decisions sd
     JOIN submissions s ON s.id = sd.submission_id
     WHERE s.conference_id = ? AND s.deleted_at IS NULL AND sd.stage = 'abstract'
     GROUP BY sd.decision`,
    [conferenceId],
  )
  let accepted = 0
  let decided = 0
  for (const row of rows as Array<{ decision: string; count: number }>) {
    const count = Number(row.count)
    decided += count
    if (row.decision === 'accepted') accepted += count
  }
  return { numerator: accepted, denominator: decided, rate: decided > 0 ? accepted / decided : 0 }
}

export type ReviewProgress = { assigned: number; submitted: number; overdue: number }

async function reviewProgress(conferenceId: string): Promise<ReviewProgress> {
  const [rows] = await pool.query(
    `SELECT
       SUM(CASE WHEN status IN ('assigned','in_progress') THEN 1 ELSE 0 END) AS assigned,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS submitted,
       SUM(CASE WHEN status IN ('assigned','in_progress') AND due_at < NOW(3) THEN 1 ELSE 0 END) AS overdue
     FROM review_assignments WHERE conference_id = ?`,
    [conferenceId],
  )
  const row = (rows as Array<{ assigned: number | null; submitted: number | null; overdue: number | null }>)[0]
  return { assigned: Number(row?.assigned ?? 0), submitted: Number(row?.submitted ?? 0), overdue: Number(row?.overdue ?? 0) }
}

async function avgReviewScorePerTrack(conferenceId: string): Promise<Array<{ name: string; avg_score: number | null }>> {
  const [rows] = await pool.query(
    `SELECT t.name AS name, AVG(r.overall_score) AS avg_score
     FROM conference_tracks t
     LEFT JOIN submissions s ON s.track_id = t.id AND s.deleted_at IS NULL
     LEFT JOIN review_assignments ra ON ra.submission_id = s.id
     LEFT JOIN reviews r ON r.assignment_id = ra.id AND r.status = 'submitted'
     WHERE t.conference_id = ?
     GROUP BY t.id, t.name
     ORDER BY t.display_order, t.name`,
    [conferenceId],
  )
  return (rows as Array<{ name: string; avg_score: string | null }>).map((r) => ({
    name: r.name,
    avg_score: r.avg_score === null ? null : Number(r.avg_score),
  }))
}

async function registrationsOverTime(conferenceId: string, timezone: string, range: DateRange): Promise<DailyPoint[]> {
  const { startUtc, endUtc } = localDateRangeToUtc(range.from, range.to, timezone)
  const [rows] = await pool.query(
    `SELECT registered_at FROM registrations WHERE conference_id = ? AND registered_at BETWEEN ? AND ?`,
    [conferenceId, startUtc, endUtc],
  )
  const counts = new Map<string, number>()
  for (const row of rows as Array<{ registered_at: string }>) {
    const key = localDateKey(timezone, new Date(row.registered_at))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return fillDailySeries(range.from, range.to, counts)
}

async function registrationsByCategory(conferenceId: string): Promise<NamedCount[]> {
  const [rows] = await pool.query(
    `SELECT rc.name AS name, COUNT(r.id) AS count
     FROM registration_categories rc
     LEFT JOIN registrations r ON r.category_id = rc.id AND r.status <> 'cancelled'
     WHERE rc.conference_id = ?
     GROUP BY rc.id, rc.name
     ORDER BY rc.display_order, rc.name`,
    [conferenceId],
  )
  return (rows as Array<{ name: string; count: number }>).map((r) => ({ name: r.name, count: Number(r.count) }))
}

export type HourPoint = { hour: number; count: number }

/** Bucketed in the conference's own timezone, in JS (not MySQL CONVERT_TZ — this app never relies on the server's timezone tables being loaded, see utils/timezone.ts). */
async function checkinsPerHour(conferenceId: string, timezone: string, startDate: string, endDate: string): Promise<HourPoint[]> {
  const { startUtc, endUtc } = localDateRangeToUtc(startDate, endDate, timezone)
  const [rows] = await pool.query(
    `SELECT checked_in_at FROM conference_attendance WHERE conference_id = ? AND checked_in_at BETWEEN ? AND ?`,
    [conferenceId, startUtc, endUtc],
  )
  const counts = new Array(24).fill(0) as number[]
  const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false })
  for (const row of rows as Array<{ checked_in_at: string }>) {
    const hour = Number(hourFormatter.format(new Date(row.checked_in_at))) % 24
    counts[hour]!++
  }
  return counts.map((count, hour) => ({ hour, count }))
}

async function attendanceRate(conferenceId: string, timezone: string): Promise<RateStat> {
  const today = localDateKey(timezone)
  const [[confirmedRows], [checkedInRows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS count FROM registrations WHERE conference_id = ? AND status = 'confirmed'`, [conferenceId]),
    pool.query(`SELECT COUNT(DISTINCT registration_id) AS count FROM conference_attendance WHERE conference_id = ? AND attendance_date <= ?`, [
      conferenceId,
      today,
    ]),
  ])
  const confirmed = Number((confirmedRows as Array<{ count: number }>)[0]?.count ?? 0)
  const checkedIn = Number((checkedInRows as Array<{ count: number }>)[0]?.count ?? 0)
  return { numerator: checkedIn, denominator: confirmed, rate: confirmed > 0 ? checkedIn / confirmed : 0 }
}

export type ConvenorAnalytics = {
  range: DateRange
  submissions_per_day: DailyPoint[]
  submissions_per_track: NamedCount[]
  acceptance_rate: RateStat
  review_progress: ReviewProgress
  avg_review_score_per_track: Array<{ name: string; avg_score: number | null }>
  registrations_over_time: DailyPoint[]
  registrations_by_category: NamedCount[]
  checkins_per_hour: HourPoint[]
  attendance_rate: RateStat
}

const CACHE_TTL_MS = 60_000
const convenorCache = new Map<string, { expiresAt: number; data: ConvenorAnalytics }>()

export async function getConvenorAnalytics(conferenceId: string, input: Partial<DateRange>): Promise<ConvenorAnalytics> {
  const range = resolveRange(input)
  const cacheKey = `${conferenceId}:${range.from}:${range.to}`
  const cached = convenorCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const conference = await loadConference(conferenceId)
  const [
    submissions_per_day,
    submissions_per_track,
    acceptance_rate_result,
    review_progress_result,
    avg_review_score_per_track,
    registrations_over_time,
    registrations_by_category,
    checkins_per_hour,
    attendance_rate_result,
  ] = await Promise.all([
    submissionsPerDay(conferenceId, conference.timezone, range),
    submissionsPerTrack(conferenceId),
    acceptanceRate(conferenceId),
    reviewProgress(conferenceId),
    avgReviewScorePerTrack(conferenceId),
    registrationsOverTime(conferenceId, conference.timezone, range),
    registrationsByCategory(conferenceId),
    checkinsPerHour(conferenceId, conference.timezone, conference.startDate, conference.endDate),
    attendanceRate(conferenceId, conference.timezone),
  ])

  const data: ConvenorAnalytics = {
    range,
    submissions_per_day,
    submissions_per_track,
    acceptance_rate: acceptance_rate_result,
    review_progress: review_progress_result,
    avg_review_score_per_track,
    registrations_over_time,
    registrations_by_category,
    checkins_per_hour,
    attendance_rate: attendance_rate_result,
  }
  convenorCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data })
  return data
}

// -----------------------------------------------------------------------
// Platform analytics (super admin)
// -----------------------------------------------------------------------

async function conferencesByStatus(): Promise<NamedCount[]> {
  const [rows] = await pool.query(
    `SELECT status AS name, COUNT(*) AS count FROM conferences WHERE deleted_at IS NULL GROUP BY status ORDER BY status`,
  )
  return (rows as Array<{ name: string; count: number }>).map((r) => ({ name: r.name, count: Number(r.count) }))
}

async function usersOverTime(range: DateRange): Promise<DailyPoint[]> {
  const [rows] = await pool.query(
    `SELECT created_at FROM users WHERE created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`,
    [`${range.from} 00:00:00`, range.to],
  )
  const counts = new Map<string, number>()
  for (const row of rows as Array<{ created_at: string }>) {
    const key = localDateKey('UTC', new Date(row.created_at))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return fillDailySeries(range.from, range.to, counts)
}

export type EmailDayPoint = { date: string; sent: number; failed: number }

async function emailsSentFailedPerDay(range: DateRange): Promise<EmailDayPoint[]> {
  const [rows] = await pool.query(
    `SELECT queued_at, status FROM email_logs WHERE queued_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`,
    [`${range.from} 00:00:00`, range.to],
  )
  const sent = new Map<string, number>()
  const failed = new Map<string, number>()
  for (const row of rows as Array<{ queued_at: string; status: string }>) {
    const key = localDateKey('UTC', new Date(row.queued_at))
    if (row.status === 'sent' || row.status === 'delivered') sent.set(key, (sent.get(key) ?? 0) + 1)
    else if (row.status === 'failed' || row.status === 'bounced') failed.set(key, (failed.get(key) ?? 0) + 1)
  }
  const days = fillDailySeries(range.from, range.to, new Map())
  return days.map((d) => ({ date: d.date, sent: sent.get(d.date) ?? 0, failed: failed.get(d.date) ?? 0 }))
}

export type WeekPoint = { week_start: string; count: number }

async function suggestionsPerWeek(range: DateRange): Promise<WeekPoint[]> {
  const [rows] = await pool.query(
    `SELECT created_at FROM suggestions WHERE created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`,
    [`${range.from} 00:00:00`, range.to],
  )
  const counts = new Map<string, number>()
  for (const row of rows as Array<{ created_at: string }>) {
    const d = new Date(row.created_at)
    const dayOfWeek = d.getUTCDay() // 0=Sun
    const weekStart = new Date(d.getTime() - dayOfWeek * 86_400_000)
    const key = weekStart.toISOString().slice(0, 10)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week_start, count]) => ({ week_start, count }))
}

export type PlatformAnalytics = {
  range: DateRange
  conferences_by_status: NamedCount[]
  users_over_time: DailyPoint[]
  emails_per_day: EmailDayPoint[]
  suggestions_per_week: WeekPoint[]
}

const platformCache = new Map<string, { expiresAt: number; data: PlatformAnalytics }>()

export async function getPlatformAnalytics(input: Partial<DateRange>): Promise<PlatformAnalytics> {
  const range = resolveRange(input)
  const cacheKey = `${range.from}:${range.to}`
  const cached = platformCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const [conferences_by_status, users_over_time, emails_per_day, suggestions_per_week] = await Promise.all([
    conferencesByStatus(),
    usersOverTime(range),
    emailsSentFailedPerDay(range),
    suggestionsPerWeek(range),
  ])

  const data: PlatformAnalytics = { range, conferences_by_status, users_over_time, emails_per_day, suggestions_per_week }
  platformCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data })
  return data
}

/** Both caches outlive a single request (module-level, 60s TTL) — a test that wipes the database with resetDatabase() must also clear these, or it can read back a previous test's stale cached result. */
export function clearAnalyticsCacheForTesting(): void {
  convenorCache.clear()
  platformCache.clear()
}
