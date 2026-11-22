import ExcelJS from 'exceljs'
import { pool } from '../../db/pool.js'
import { isPlatformAdmin, getConferencePermissions } from '../auth/service.js'
import { csvCell } from '../../utils/csv.js'

export async function canReadAllReviews(userId: string, conferenceId: string): Promise<boolean> {
  if (await isPlatformAdmin(userId)) return true
  const permissions = await getConferencePermissions(userId, conferenceId)
  return permissions.has('review.read_all')
}

function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  return lines.join('\n')
}

async function toXlsx(sheetName: string, header: string[], rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.addRow(header)
  sheet.getRow(1).font = { bold: true }
  for (const row of rows) sheet.addRow(row)
  sheet.columns.forEach((col) => {
    col.width = 22
  })
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

type SubmissionReportRow = {
  submission_code: string | null
  title: string
  track_name: string
  status: string
  authors: string
  avg_score: number | null
  decision: string | null
}

async function loadSubmissionsReport(conferenceId: string): Promise<{ header: string[]; rows: unknown[][] }> {
  const [rows] = await pool.query(
    `SELECT s.submission_code, s.title, t.name AS track_name, s.status,
            (SELECT GROUP_CONCAT(sa.full_name ORDER BY sa.author_order SEPARATOR '; ')
               FROM submission_authors sa WHERE sa.submission_id = s.id) AS authors,
            (SELECT AVG(r.overall_score) FROM reviews r
               JOIN review_assignments ra ON ra.id = r.assignment_id
               WHERE ra.submission_id = s.id AND r.status = 'submitted') AS avg_score,
            (SELECT sd.decision FROM submission_decisions sd
               WHERE sd.submission_id = s.id AND sd.stage = 'abstract'
               ORDER BY sd.round DESC LIMIT 1) AS decision
     FROM submissions s
     JOIN conference_tracks t ON t.id = s.track_id
     WHERE s.conference_id = ? AND s.deleted_at IS NULL AND s.status <> 'draft'
     ORDER BY s.submission_code`,
    [conferenceId],
  )
  const header = ['Code', 'Title', 'Track', 'Status', 'Authors', 'Average score', 'Decision']
  const data = (rows as SubmissionReportRow[]).map((r) => [
    r.submission_code ?? '',
    r.title,
    r.track_name,
    r.status,
    r.authors ?? '',
    r.avg_score === null ? '' : Number(r.avg_score).toFixed(2),
    r.decision ?? '',
  ])
  return { header, rows: data }
}

type ReviewReportRow = {
  submission_code: string | null
  title: string
  reviewer_name: string
  overall_score: number | null
  recommendation: string | null
  confidential_comments: string | null
}

async function loadReviewsReport(conferenceId: string, includeConfidential: boolean): Promise<{ header: string[]; rows: unknown[][] }> {
  const [rows] = await pool.query(
    `SELECT s.submission_code, s.title, u.full_name AS reviewer_name,
            r.originality, r.quality, r.relevance, r.methodology, r.overall_score, r.confidence,
            r.recommendation, r.confidential_comments
     FROM reviews r
     JOIN review_assignments ra ON ra.id = r.assignment_id
     JOIN submissions s ON s.id = ra.submission_id
     JOIN users u ON u.id = ra.reviewer_id
     WHERE ra.conference_id = ? AND r.status = 'submitted'
     ORDER BY s.submission_code`,
    [conferenceId],
  )
  const header = [
    'Paper code',
    'Title',
    'Reviewer',
    'Originality',
    'Quality',
    'Relevance',
    'Methodology',
    'Overall score',
    'Confidence',
    'Recommendation',
    ...(includeConfidential ? ['Confidential comments'] : []),
  ]
  const data = (
    rows as Array<
      ReviewReportRow & {
        originality: number | null
        quality: number | null
        relevance: number | null
        methodology: number | null
        confidence: number | null
      }
    >
  ).map((r) => [
    r.submission_code ?? '',
    r.title,
    includeConfidential ? r.reviewer_name : 'Reviewer',
    r.originality ?? '',
    r.quality ?? '',
    r.relevance ?? '',
    r.methodology ?? '',
    r.overall_score ?? '',
    r.confidence ?? '',
    r.recommendation ?? '',
    ...(includeConfidential ? [r.confidential_comments ?? ''] : []),
  ])
  return { header, rows: data }
}

async function loadMembersReport(conferenceId: string): Promise<{ header: string[]; rows: unknown[][] }> {
  const [rows] = await pool.query(
    `SELECT u.full_name, u.email, cm.role_code, cm.status, cm.created_at
     FROM conference_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.conference_id = ? ORDER BY u.full_name`,
    [conferenceId],
  )
  const header = ['Name', 'Email', 'Role', 'Status', 'Joined']
  const data = (rows as Array<{ full_name: string; email: string; role_code: string; status: string; created_at: string }>).map(
    (r) => [r.full_name, r.email, r.role_code, r.status, r.created_at],
  )
  return { header, rows: data }
}

async function loadCommitteesReport(conferenceId: string): Promise<{ header: string[]; rows: unknown[][] }> {
  const [rows] = await pool.query(
    `SELECT c.name AS committee_name, c.committee_type, COALESCE(u.full_name, cm.display_name) AS member_name,
            cm.member_role, cm.affiliation, cm.country
     FROM committees c
     JOIN committee_members cm ON cm.committee_id = c.id
     LEFT JOIN users u ON u.id = cm.user_id
     WHERE c.conference_id = ?
     ORDER BY c.display_order, cm.display_order`,
    [conferenceId],
  )
  const header = ['Committee', 'Type', 'Member', 'Role', 'Affiliation', 'Country']
  const data = (
    rows as Array<{ committee_name: string; committee_type: string; member_name: string; member_role: string; affiliation: string | null; country: string | null }>
  ).map((r) => [r.committee_name, r.committee_type, r.member_name, r.member_role, r.affiliation ?? '', r.country ?? ''])
  return { header, rows: data }
}

async function conferenceTimezone(conferenceId: string): Promise<string> {
  const [rows] = await pool.query('SELECT timezone FROM conferences WHERE id = ?', [conferenceId])
  return (rows as Array<{ timezone: string }>)[0]?.timezone ?? 'UTC'
}

/** "2026-11-22 14:05" in the conference's own timezone, or '' when there is no time. */
function localDateTime(value: Date | string | null, timeZone: string): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

async function loadRegistrationsReport(conferenceId: string): Promise<{ header: string[]; rows: unknown[][] }> {
  const timeZone = await conferenceTimezone(conferenceId)
  const [rows] = await pool.query(
    `SELECT r.registration_number, u.full_name, u.email, rc.name AS category_name, r.status,
            r.amount_due, r.currency, r.registered_at, r.confirmed_at, r.cancelled_at,
            (SELECT COUNT(*) FROM conference_attendance ca WHERE ca.registration_id = r.id) AS days_attended,
            (SELECT COUNT(*) FROM session_attendance sa WHERE sa.registration_id = r.id) AS sessions_attended
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     JOIN registration_categories rc ON rc.id = r.category_id
     WHERE r.conference_id = ?
     ORDER BY r.registered_at`,
    [conferenceId],
  )
  const header = [
    'Registration no.',
    'Name',
    'Email',
    'Category',
    'Status',
    'Amount due',
    'Currency',
    'Registered',
    'Confirmed',
    'Cancelled',
    'Days attended',
    'Sessions attended',
  ]
  const data = (
    rows as Array<{
      registration_number: string
      full_name: string
      email: string
      category_name: string
      status: string
      amount_due: string | number
      currency: string
      registered_at: Date | null
      confirmed_at: Date | null
      cancelled_at: Date | null
      days_attended: number
      sessions_attended: number
    }>
  ).map((r) => [
    r.registration_number,
    r.full_name,
    r.email,
    r.category_name,
    r.status,
    Number(r.amount_due),
    r.currency,
    localDateTime(r.registered_at, timeZone),
    localDateTime(r.confirmed_at, timeZone),
    localDateTime(r.cancelled_at, timeZone),
    Number(r.days_attended),
    Number(r.sessions_attended),
  ])
  return { header, rows: data }
}

async function loadAttendanceReport(conferenceId: string): Promise<{ header: string[]; rows: unknown[][] }> {
  const timeZone = await conferenceTimezone(conferenceId)
  const [rows] = await pool.query(
    `SELECT ca.attendance_date, r.registration_number, u.full_name, u.email, rc.name AS category_name,
            ca.checked_in_at, ca.checked_out_at, ca.method, staff.full_name AS checked_in_by
     FROM conference_attendance ca
     JOIN registrations r ON r.id = ca.registration_id
     JOIN users u ON u.id = ca.user_id
     JOIN registration_categories rc ON rc.id = r.category_id
     LEFT JOIN users staff ON staff.id = ca.checked_in_by
     WHERE ca.conference_id = ?
     ORDER BY ca.attendance_date, ca.checked_in_at`,
    [conferenceId],
  )
  const header = ['Date', 'Registration no.', 'Name', 'Email', 'Category', 'Checked in', 'Checked out', 'Method', 'Checked in by']
  const data = (
    rows as Array<{
      attendance_date: string
      registration_number: string
      full_name: string
      email: string
      category_name: string
      checked_in_at: Date
      checked_out_at: Date | null
      method: string
      checked_in_by: string | null
    }>
  ).map((r) => [
    r.attendance_date,
    r.registration_number,
    r.full_name,
    r.email,
    r.category_name,
    localDateTime(r.checked_in_at, timeZone),
    localDateTime(r.checked_out_at, timeZone),
    r.method === 'qr' ? 'QR scan' : 'Manual',
    r.checked_in_by ?? '',
  ])
  return { header, rows: data }
}

export type ReportKind = 'submissions' | 'reviews' | 'members' | 'committees' | 'registrations' | 'attendance'

/** Reports that list attendees' personal details: they also need the registration-desk permission. */
export const REGISTRATION_REPORT_KINDS: ReadonlySet<ReportKind> = new Set(['registrations', 'attendance'])

export async function canReadRegistrations(userId: string, conferenceId: string): Promise<boolean> {
  if (await isPlatformAdmin(userId)) return true
  const permissions = await getConferencePermissions(userId, conferenceId)
  return permissions.has('registration.read_all')
}

async function loadReport(
  kind: ReportKind,
  conferenceId: string,
  includeConfidential: boolean,
): Promise<{ header: string[]; rows: unknown[][] }> {
  switch (kind) {
    case 'submissions':
      return loadSubmissionsReport(conferenceId)
    case 'reviews':
      return loadReviewsReport(conferenceId, includeConfidential)
    case 'members':
      return loadMembersReport(conferenceId)
    case 'committees':
      return loadCommitteesReport(conferenceId)
    case 'registrations':
      return loadRegistrationsReport(conferenceId)
    case 'attendance':
      return loadAttendanceReport(conferenceId)
  }
}

export async function exportReportCsv(kind: ReportKind, conferenceId: string, includeConfidential: boolean): Promise<string> {
  const { header, rows } = await loadReport(kind, conferenceId, includeConfidential)
  return toCsv(header, rows)
}

export async function exportReportXlsx(kind: ReportKind, conferenceId: string, includeConfidential: boolean): Promise<Buffer> {
  const { header, rows } = await loadReport(kind, conferenceId, includeConfidential)
  return toXlsx(kind, header, rows)
}
