/**
 * The app reads every date/time input as Nepal time (Asia/Kathmandu, UTC+5:45), whatever the
 * browser's own timezone. Specs must therefore type Nepal wall-clock values too, or a window
 * meant to be open "now" can land hours in the future on a machine in another timezone.
 */
const NEPAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kathmandu',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "YYYY-MM-DDTHH:mm" for a datetime-local input, in Nepal time. */
export function nepalInput(d: Date): string {
  const p = Object.fromEntries(NEPAL.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** Midnight at the start of the Nepal calendar day `daysFromToday` days from now. */
export function nepalMidnight(daysFromToday = 0): string {
  return `${nepalInput(new Date(Date.now() + daysFromToday * 86_400_000)).slice(0, 10)}T00:00`
}
