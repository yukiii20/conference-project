/**
 * RFC 5545 calendar output shared by the single-session "Add to calendar"
 * download, the "My agenda" download and the private calendar feed.
 *
 * Times are written as local wall-clock time with TZID=<conference
 * timezone> (Asia/Kathmandu for every conference so far) plus a matching
 * VTIMEZONE block, so Google Calendar / Outlook show 9:00 in Kathmandu as
 * 9:00 Kathmandu time instead of guessing from a UTC instant. The VTIMEZONE
 * carries the zone's current UTC offset as a single STANDARD rule - exact
 * for Nepal (fixed +05:45, no daylight saving) and for any other zone
 * without DST.
 */

export type IcsEvent = {
  uid: string
  startsAt: string | Date
  endsAt: string | Date
  summary: string
  location?: string | null
  description?: string | null
  url?: string | null
}

export type IcsCalendar = {
  name: string
  timezone: string
  events: IcsEvent[]
  /** Feed-only: how often a subscribing calendar app should re-fetch. */
  refreshMinutes?: number
}

export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function utcStamp(value: string | Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** "YYYYMMDDTHHMMSS" wall-clock time of `value` in `timeZone`. */
export function localStamp(value: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`
}

/** "+0545" style UTC offset of `timeZone` at `at`. */
export function utcOffset(timeZone: string, at: Date = new Date()): string {
  const local = localStamp(at, timeZone)
  const asUtc = Date.UTC(
    Number(local.slice(0, 4)),
    Number(local.slice(4, 6)) - 1,
    Number(local.slice(6, 8)),
    Number(local.slice(9, 11)),
    Number(local.slice(11, 13)),
    Number(local.slice(13, 15)),
  )
  const minutes = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`
}

/** Folds a content line to at most 75 octets per physical line (RFC 5545 3.1), never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const out: string[] = []
  let current = ''
  let currentBytes = 0
  for (const ch of line) {
    const bytes = Buffer.byteLength(ch, 'utf8')
    const limit = out.length === 0 ? 75 : 74 // continuation lines start with one space
    if (currentBytes + bytes > limit) {
      out.push(current)
      current = ''
      currentBytes = 0
    }
    current += ch
    currentBytes += bytes
  }
  out.push(current)
  return out.join('\r\n ')
}

export function generateIcs(calendar: IcsCalendar, now: Date = new Date()): string {
  const tz = calendar.timezone
  const offset = utcOffset(tz, calendar.events[0] ? new Date(calendar.events[0].startsAt) : now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Conference Management System//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calendar.name)}`,
    `X-WR-TIMEZONE:${tz}`,
  ]
  if (calendar.refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${calendar.refreshMinutes}M`)
    lines.push(`X-PUBLISHED-TTL:PT${calendar.refreshMinutes}M`)
  }
  lines.push(
    'BEGIN:VTIMEZONE',
    `TZID:${tz}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    `TZOFFSETFROM:${offset}`,
    `TZOFFSETTO:${offset}`,
    `TZNAME:${offset}`,
    'END:STANDARD',
    'END:VTIMEZONE',
  )
  for (const event of calendar.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART;TZID=${tz}:${localStamp(event.startsAt, tz)}`,
      `DTEND;TZID=${tz}:${localStamp(event.endsAt, tz)}`,
      `SUMMARY:${icsEscape(event.summary)}`,
    )
    if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`)
    if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`)
    if (event.url) lines.push(`URL:${event.url}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
