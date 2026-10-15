import PDFDocument from 'pdfkit'
import type { PublicSessionRow } from './service.js'

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function icsDate(value: string | Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** A single-event .ics file for one session — "add to calendar". */
export function generateSessionIcs(session: PublicSessionRow, conferenceName: string): string {
  const location = session.room ? `${session.room.name}${session.room.building ? `, ${session.room.building}` : ''}` : ''
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Conference Management System//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${session.id}@conference-management-system`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(session.starts_at)}`,
    `DTEND:${icsDate(session.ends_at)}`,
    `SUMMARY:${icsEscape(`${conferenceName}: ${session.title}`)}`,
    location ? `LOCATION:${icsEscape(location)}` : null,
    session.description ? `DESCRIPTION:${icsEscape(session.description)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((line): line is string => line !== null)
  return lines.join('\r\n')
}

/** The full published programme as a PDF, grouped by day, for "Download programme". */
export function generateProgrammePdf(
  conferenceName: string,
  timezone: string,
  sessions: PublicSessionRow[],
): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: 50, size: 'A4' })

  doc.fontSize(20).text(conferenceName, { align: 'center' })
  doc.fontSize(14).fillColor('#555').text('Programme', { align: 'center' })
  doc.moveDown(1.5)
  doc.fillColor('#000')

  const dayFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })

  let currentDay = ''
  for (const session of sessions) {
    const day = dayFormatter.format(new Date(session.starts_at))
    if (day !== currentDay) {
      currentDay = day
      if (doc.y > 100) doc.moveDown(1)
      doc.fontSize(15).fillColor('#1a1a1a').text(day, { underline: true })
      doc.moveDown(0.3)
    }

    const time = `${timeFormatter.format(new Date(session.starts_at))} - ${timeFormatter.format(new Date(session.ends_at))}`
    const room = session.room ? session.room.name : ''
    doc.fontSize(11).fillColor('#000').text(`${time}  ${session.title}${room ? `  (${room})` : ''}`, { continued: false })

    if (session.chairs.length > 0) {
      doc
        .fontSize(9)
        .fillColor('#555')
        .text(`Chair: ${session.chairs.map((c) => c.full_name).join(', ')}`)
    }
    for (const p of session.presentations) {
      const who = p.authors && p.authors.length > 0 ? p.authors.join(', ') : p.speaker_name ?? ''
      doc.fontSize(9).fillColor('#333').text(`  - ${p.title}${who ? ` — ${who}` : ''}`)
    }
    doc.fillColor('#000')
    doc.moveDown(0.6)

    if (doc.y > 760) doc.addPage()
  }

  if (sessions.length === 0) {
    doc.fontSize(12).text('The programme has not been published yet.')
  }

  doc.end()
  return doc
}
