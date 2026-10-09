// Nepal has a single fixed UTC+5:45 offset and no daylight saving, so a
// constant-offset conversion is exact (no IANA tz database lookup needed for
// the round-trip to/from <input type="datetime-local">).
const KATHMANDU_OFFSET_MS = (5 * 60 + 45) * 60 * 1000

/** ISO timestamptz -> "YYYY-MM-DDTHH:mm" for a datetime-local input, in Asia/Kathmandu wall-clock time. */
export function toKathmanduInputValue(iso: string | null): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  return new Date(ms + KATHMANDU_OFFSET_MS).toISOString().slice(0, 16)
}

/** "YYYY-MM-DDTHH:mm" (Asia/Kathmandu wall-clock) -> ISO timestamptz (UTC) for storage. */
export function fromKathmanduInputValue(local: string): string | null {
  // Date.parse is too lenient to trust directly here: V8 will happily turn
  // unrelated garbage strings into *some* date instead of NaN, so the shape
  // must be checked first (datetime-local inputs always produce this shape).
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const asUtcMs = Date.parse(`${local}:00Z`)
  if (Number.isNaN(asUtcMs)) return null
  return new Date(asUtcMs - KATHMANDU_OFFSET_MS).toISOString()
}

/** ISO timestamptz -> "YYYY-MM-DD" for a date input, in Asia/Kathmandu wall-clock time. */
export function toKathmanduDateInputValue(iso: string | null): string {
  return toKathmanduInputValue(iso).slice(0, 10)
}

/** "YYYY-MM-DD" (Asia/Kathmandu wall-clock) -> ISO timestamptz (UTC) for storage. */
export function fromKathmanduDateInputValue(local: string): string | null {
  if (!local) return null
  return fromKathmanduInputValue(`${local}T00:00`)
}

/** Friendly display string in Asia/Kathmandu time, e.g. "15 Nov 2026, 9:00 am". */
export function formatKathmandu(iso: string | null, opts?: { dateOnly?: boolean }): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return '—'
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(opts?.dateOnly ? {} : { hour: 'numeric', minute: '2-digit', hour12: true }),
  })
  return formatter.format(new Date(iso))
}

/** "YYYY-MM-DD" calendar key for an ISO timestamp, in Asia/Kathmandu — used to group sessions by day. */
export function kathmanduDateKey(iso: string): string {
  return toKathmanduDateInputValue(iso)
}

/** Time-only display in Asia/Kathmandu, e.g. "9:00 am". */
export function formatKathmanduTime(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

/** "15–17 Nov 2026" / "30 Nov – 2 Dec 2026" style date-only range, for plain YYYY-MM-DD dates (not timezone-shifted). */
export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric' })
  const fullFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  if (startDate === endDate) return fullFmt.format(start)
  if (sameMonth) {
    const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(start)
    return `${dayFmt.format(start)}–${dayFmt.format(end)} ${monthYear}`
  }
  return `${fullFmt.format(start)} – ${fullFmt.format(end)}`
}
