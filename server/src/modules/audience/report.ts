import { pool } from '../../db/pool.js'
import { csvRow } from '../../utils/csv.js'

export type AudienceReportRow = {
  full_name: string
  email: string
  registration_number: string
  category: string
  registration_status: string
  checked_in: boolean
  sessions_attended: number
  sessions_online: number
  questions_asked: number
  gave_conference_feedback: boolean
  sessions_rated: number
  certificate_eligible: boolean
}

export type AudienceReport = {
  summary: {
    audience_members: number
    confirmed: number
    checked_in: number
    attended_online: number
    questions: number
    conference_feedback: number
    session_ratings: number
    certificate_eligible: number
  }
  rows: AudienceReportRow[]
}

/**
 * One row per Audience member of this conference (active 'attendee' membership) with their
 * latest registration. Organisers only (report.view). Question / feedback counts include
 * anonymous ones - the report never shows their text, only that the person took part.
 */
export async function getAudienceReport(conferenceId: string): Promise<AudienceReport> {
  const [rows] = await pool.query(
    `SELECT u.full_name, u.email,
            r.registration_number, rc.name AS category, r.status AS registration_status,
            EXISTS (SELECT 1 FROM conference_attendance ca WHERE ca.registration_id = r.id) AS checked_in,
            (SELECT COUNT(*) FROM session_attendance sa WHERE sa.conference_id = cm.conference_id AND sa.user_id = u.id) AS sessions_attended,
            (SELECT COUNT(*) FROM session_attendance sa WHERE sa.conference_id = cm.conference_id AND sa.user_id = u.id AND sa.method = 'online') AS sessions_online,
            (SELECT COUNT(*) FROM session_questions q WHERE q.conference_id = cm.conference_id AND q.user_id = u.id AND q.status <> 'deleted') AS questions_asked,
            EXISTS (SELECT 1 FROM conference_feedback f WHERE f.conference_id = cm.conference_id AND f.audience_user_id = u.id AND f.status <> 'deleted') AS gave_conference_feedback,
            (SELECT COUNT(*) FROM session_ratings sr WHERE sr.conference_id = cm.conference_id AND sr.user_id = u.id AND sr.status <> 'deleted') AS sessions_rated,
            cs.certificate_min_sessions
     FROM conference_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN registrations r ON r.id = (
       SELECT r2.id FROM registrations r2 WHERE r2.conference_id = cm.conference_id AND r2.user_id = cm.user_id ORDER BY r2.created_at DESC LIMIT 1
     )
     LEFT JOIN registration_categories rc ON rc.id = r.category_id
     LEFT JOIN conference_settings cs ON cs.conference_id = cm.conference_id
     WHERE cm.conference_id = ? AND cm.role_code = 'attendee' AND cm.status = 'active'
     ORDER BY u.full_name`,
    [conferenceId],
  )
  const list = (rows as Array<Record<string, unknown>>).map((r) => {
    const attended = Number(r.sessions_attended)
    const min = r.certificate_min_sessions == null ? null : Number(r.certificate_min_sessions)
    const checkedIn = Boolean(Number(r.checked_in))
    return {
      full_name: String(r.full_name),
      email: String(r.email),
      registration_number: r.registration_number == null ? '' : String(r.registration_number),
      category: r.category == null ? '' : String(r.category),
      registration_status: r.registration_status == null ? 'none' : String(r.registration_status),
      checked_in: checkedIn,
      sessions_attended: attended,
      sessions_online: Number(r.sessions_online),
      questions_asked: Number(r.questions_asked),
      gave_conference_feedback: Boolean(Number(r.gave_conference_feedback)),
      sessions_rated: Number(r.sessions_rated),
      certificate_eligible: r.registration_status === 'confirmed' && checkedIn && (min == null || attended >= min),
    } satisfies AudienceReportRow
  })
  return {
    summary: {
      audience_members: list.length,
      confirmed: list.filter((r) => r.registration_status === 'confirmed').length,
      checked_in: list.filter((r) => r.checked_in).length,
      attended_online: list.filter((r) => r.sessions_online > 0).length,
      questions: list.reduce((n, r) => n + r.questions_asked, 0),
      conference_feedback: list.filter((r) => r.gave_conference_feedback).length,
      session_ratings: list.reduce((n, r) => n + r.sessions_rated, 0),
      certificate_eligible: list.filter((r) => r.certificate_eligible).length,
    },
    rows: list,
  }
}

export function audienceReportCsv(report: AudienceReport): string {
  const header = [
    'Name',
    'Email',
    'Ticket number',
    'Category',
    'Registration status',
    'Checked in',
    'Sessions attended',
    'Of which online',
    'Questions asked',
    'Conference feedback',
    'Sessions rated',
    'Certificate eligible',
  ]
  const yn = (v: boolean) => (v ? 'Yes' : 'No')
  return [
    csvRow(header),
    ...report.rows.map((r) =>
      csvRow([
        r.full_name,
        r.email,
        r.registration_number,
        r.category,
        r.registration_status,
        yn(r.checked_in),
        r.sessions_attended,
        r.sessions_online,
        r.questions_asked,
        yn(r.gave_conference_feedback),
        r.sessions_rated,
        yn(r.certificate_eligible),
      ]),
    ),
  ].join('\r\n')
}

/**
 * Every Audience question of this conference (not deleted), for the organisers' CSV. Organisers
 * may see who asked an anonymous question (it is only hidden from other Audience members), so
 * the name is included and the "Asked anonymously" column says so.
 */
export async function audienceQuestionsCsv(conferenceId: string): Promise<string> {
  const [rows] = await pool.query(
    `SELECT s.title AS session_title, s.starts_at, p.title AS presentation_title, q.body, q.vote_count, q.status,
            q.is_anonymous, u.full_name, q.created_at
     FROM session_questions q
     JOIN conference_sessions s ON s.id = q.session_id
     LEFT JOIN presentations p ON p.id = q.presentation_id
     JOIN users u ON u.id = q.user_id
     WHERE q.conference_id = ? AND q.status <> 'deleted'
     ORDER BY s.starts_at, s.title, q.vote_count DESC, q.created_at`,
    [conferenceId],
  )
  const header = ['Session', 'Session starts (UTC)', 'Presentation', 'Question', 'Votes', 'Status', 'Asked by', 'Asked anonymously', 'Asked at (UTC)']
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString().replace('T', ' ').slice(0, 16) : '')
  return [
    csvRow(header),
    ...(rows as Array<Record<string, unknown>>).map((r) =>
      csvRow([
        String(r.session_title),
        iso(r.starts_at),
        r.presentation_title == null ? '' : String(r.presentation_title),
        String(r.body),
        Number(r.vote_count),
        String(r.status),
        String(r.full_name),
        Number(r.is_anonymous) ? 'Yes' : 'No',
        iso(r.created_at),
      ]),
    ),
  ].join('\r\n')
}
