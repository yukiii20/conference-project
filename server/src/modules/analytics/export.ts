import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'
import type { ConvenorAnalytics, PlatformAnalytics } from './service.js'

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function drawSection(doc: PDFKit.PDFDocument, title: string, rows: string[]): void {
  if (doc.y > 700) doc.addPage()
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#1A1A1A').text(title, { paragraphGap: 4 })
  doc.font('Helvetica').fontSize(10).fillColor('#333333')
  for (const row of rows) {
    doc.text(row, { indent: 10 })
  }
  doc.moveDown(0.75)
}

/** Charts + numbers, as a plain numeric report (no rasterized chart images — pdfkit has no chart renderer, and every number shown here is also in the Excel export and the on-screen chart for cross-reference). */
export async function generateConvenorAnalyticsPdf(conferenceName: string, data: ConvenorAnalytics): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#1A1A1A').text('Analytics report')
  doc.font('Helvetica').fontSize(11).fillColor('#555555').text(`${conferenceName} — ${data.range.from} to ${data.range.to}`)
  doc.moveDown(1)

  drawSection(
    doc,
    'Submissions per day',
    data.submissions_per_day.map((p) => `${p.date}: ${p.count}`),
  )
  drawSection(
    doc,
    'Submissions per track',
    data.submissions_per_track.map((p) => `${p.name}: ${p.count}`),
  )
  drawSection(doc, 'Acceptance rate', [
    `${data.acceptance_rate.numerator} of ${data.acceptance_rate.denominator} decided submissions accepted (${pct(data.acceptance_rate.rate)})`,
  ])
  drawSection(doc, 'Review progress', [
    `Assigned (in progress): ${data.review_progress.assigned}`,
    `Submitted: ${data.review_progress.submitted}`,
    `Overdue: ${data.review_progress.overdue}`,
  ])
  drawSection(
    doc,
    'Average review score per track',
    data.avg_review_score_per_track.map((p) => `${p.name}: ${p.avg_score === null ? 'no reviews yet' : p.avg_score.toFixed(2)}`),
  )
  drawSection(
    doc,
    'Registrations over time',
    data.registrations_over_time.map((p) => `${p.date}: ${p.count}`),
  )
  drawSection(
    doc,
    'Registrations by category',
    data.registrations_by_category.map((p) => `${p.name}: ${p.count}`),
  )
  drawSection(
    doc,
    'Check-ins per hour (event days)',
    data.checkins_per_hour.filter((p) => p.count > 0).map((p) => `${String(p.hour).padStart(2, '0')}:00 — ${p.count}`),
  )
  drawSection(doc, 'Attendance rate', [
    `${data.attendance_rate.numerator} of ${data.attendance_rate.denominator} confirmed registrants checked in (${pct(data.attendance_rate.rate)})`,
  ])

  doc.end()
  return done
}

export async function generatePlatformAnalyticsPdf(data: PlatformAnalytics): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#1A1A1A').text('Platform analytics report')
  doc.font('Helvetica').fontSize(11).fillColor('#555555').text(`${data.range.from} to ${data.range.to}`)
  doc.moveDown(1)

  drawSection(
    doc,
    'Conferences by status',
    data.conferences_by_status.map((p) => `${p.name}: ${p.count}`),
  )
  drawSection(
    doc,
    'Users over time',
    data.users_over_time.map((p) => `${p.date}: ${p.count}`),
  )
  drawSection(
    doc,
    'Emails sent/failed per day',
    data.emails_per_day.map((p) => `${p.date}: ${p.sent} sent, ${p.failed} failed`),
  )
  drawSection(
    doc,
    'Suggestions per week',
    data.suggestions_per_week.map((p) => `Week of ${p.week_start}: ${p.count}`),
  )

  doc.end()
  return done
}

function addSheet(workbook: ExcelJS.Workbook, name: string, header: string[], rows: unknown[][]): void {
  const sheet = workbook.addWorksheet(name.slice(0, 31)) // Excel sheet-name limit
  sheet.addRow(header)
  sheet.getRow(1).font = { bold: true }
  for (const row of rows) sheet.addRow(row)
  sheet.columns.forEach((col) => {
    col.width = 20
  })
}

export async function generateConvenorAnalyticsXlsx(data: ConvenorAnalytics): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  addSheet(workbook, 'Submissions per day', ['Date', 'Count'], data.submissions_per_day.map((p) => [p.date, p.count]))
  addSheet(workbook, 'Submissions per track', ['Track', 'Count'], data.submissions_per_track.map((p) => [p.name, p.count]))
  addSheet(workbook, 'Acceptance rate', ['Accepted', 'Decided', 'Rate'], [
    [data.acceptance_rate.numerator, data.acceptance_rate.denominator, pct(data.acceptance_rate.rate)],
  ])
  addSheet(workbook, 'Review progress', ['Assigned', 'Submitted', 'Overdue'], [
    [data.review_progress.assigned, data.review_progress.submitted, data.review_progress.overdue],
  ])
  addSheet(
    workbook,
    'Avg review score per track',
    ['Track', 'Average score'],
    data.avg_review_score_per_track.map((p) => [p.name, p.avg_score ?? '']),
  )
  addSheet(workbook, 'Registrations over time', ['Date', 'Count'], data.registrations_over_time.map((p) => [p.date, p.count]))
  addSheet(workbook, 'Registrations by category', ['Category', 'Count'], data.registrations_by_category.map((p) => [p.name, p.count]))
  addSheet(workbook, 'Check-ins per hour', ['Hour', 'Count'], data.checkins_per_hour.map((p) => [p.hour, p.count]))
  addSheet(workbook, 'Attendance rate', ['Checked in', 'Confirmed', 'Rate'], [
    [data.attendance_rate.numerator, data.attendance_rate.denominator, pct(data.attendance_rate.rate)],
  ])
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export async function generatePlatformAnalyticsXlsx(data: PlatformAnalytics): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  addSheet(workbook, 'Conferences by status', ['Status', 'Count'], data.conferences_by_status.map((p) => [p.name, p.count]))
  addSheet(workbook, 'Users over time', ['Date', 'Count'], data.users_over_time.map((p) => [p.date, p.count]))
  addSheet(workbook, 'Emails per day', ['Date', 'Sent', 'Failed'], data.emails_per_day.map((p) => [p.date, p.sent, p.failed]))
  addSheet(workbook, 'Suggestions per week', ['Week start', 'Count'], data.suggestions_per_week.map((p) => [p.week_start, p.count]))
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
