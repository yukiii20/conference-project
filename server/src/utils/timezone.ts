/**
 * Local wall-clock <-> UTC conversion for an arbitrary IANA timezone, using
 * only `Intl` (no extra dependency). One correction pass is enough for every
 * real timezone except the handful of seconds around a DST transition, which
 * doesn't matter for conference-day boundaries.
 */
function offsetMsAt(timeZone: string, utcInstant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utcInstant)

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - utcInstant.getTime()
}

/** The UTC instant at which the wall clock in `timeZone` reads the given y/m/d h:m:s. */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offset = offsetMsAt(timeZone, new Date(guess))
  return new Date(guess - offset)
}

/** 'YYYY-MM-DD' for the given instant (default: now) as measured in `timeZone` — used for attendance day keys. */
export function localDateKey(timeZone: string, instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * The inclusive UTC window spanning the whole of `startDate` through the
 * whole of `endDate` (both 'YYYY-MM-DD') as measured in `timeZone`.
 */
export function localDateRangeToUtc(
  startDate: string,
  endDate: string,
  timeZone: string,
): { startUtc: Date; endUtc: Date } {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const startUtc = zonedWallTimeToUtc(sy!, sm!, sd!, 0, 0, 0, timeZone)
  const endOfDayStartUtc = zonedWallTimeToUtc(ey!, em!, ed!, 23, 59, 59, timeZone)
  const endUtc = new Date(endOfDayStartUtc.getTime() + 999)
  return { startUtc, endUtc }
}

/** Every conference so far runs on Nepal time; used where no conference timezone applies (platform-wide views). */
export const PLATFORM_TIMEZONE = 'Asia/Kathmandu'

/** 'YYYY-MM-DD' shifted by `days` calendar days (pure date arithmetic, no timezone involved). */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

/** Week bucketing (weeks start on Sunday): the Sunday that starts the week containing `dateKey`. */
export function weekStartKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() // 0 = Sunday
  return addDaysToDateKey(dateKey, -dow)
}
