import ExcelJS from 'exceljs'
import type { getResultsForExport } from './service.js'

type ExportData = Awaited<ReturnType<typeof getResultsForExport>>

function addSheet(workbook: ExcelJS.Workbook, name: string, header: string[], rows: unknown[][], widths: number[] = []): void {
  const sheet = workbook.addWorksheet(name.slice(0, 31)) // Excel sheet-name limit
  sheet.addRow(header)
  sheet.getRow(1).font = { bold: true }
  for (const row of rows) sheet.addRow(row)
  sheet.columns.forEach((col, i) => {
    col.width = widths[i] ?? 20
  })
}

function localTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

/** Summary (one row per question) + every response (one row each, "Anonymous" where chosen). */
export async function generateFeedbackXlsx(data: ExportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const tz = data.conference.timezone

  addSheet(
    workbook,
    'Summary',
    ['Question', 'Type', 'Answers', 'Average (1-5)', '1', '2', '3', '4', '5', 'Breakdown'],
    data.results.map((q) => {
      switch (q.kind) {
        case 'rating':
          return [q.prompt, 'Rating', q.answered, q.average ?? '', ...q.distribution, '']
        case 'choice':
        case 'session':
          return [q.prompt, q.kind === 'choice' ? 'Choice' : 'Best session', q.answered, '', '', '', '', '', '', q.counts.map((c) => `${c.label}: ${c.count}`).join('; ')]
        case 'text':
          return [q.prompt, 'Text', q.answered, '', '', '', '', '', '', '']
      }
    }),
    [50, 14, 10, 14, 6, 6, 6, 6, 6, 60],
  )

  const answersByResponse = new Map<string, Map<string, string | number>>()
  for (const a of data.answers) {
    const value = a.rating ?? a.text_value ?? a.choice_value ?? (a.session_id ? (data.sessionTitles.get(a.session_id) ?? 'Removed session') : null)
    if (value === null) continue
    const row = answersByResponse.get(a.response_id) ?? new Map<string, string | number>()
    row.set(a.question_id, value)
    answersByResponse.set(a.response_id, row)
  }
  addSheet(
    workbook,
    'Responses',
    ['Submitted', 'Respondent', ...data.results.map((q) => q.prompt)],
    data.responses.map((r) => [
      localTime(r.submitted_at, tz),
      r.respondent_name ?? 'Anonymous',
      ...data.results.map((q) => answersByResponse.get(r.id)?.get(q.id) ?? ''),
    ]),
    [20, 24, ...data.results.map((q) => (q.kind === 'text' ? 50 : 24))],
  )

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
