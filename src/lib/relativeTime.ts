const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "3 hours ago", "in 5 days", "yesterday", "just now". */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = t - now
  if (Math.abs(diff) < 45_000) return 'just now'
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === 'minute') return formatter.format(Math.round(diff / ms), unit)
  }
  return ''
}

/** Sum of the last `days` points of a filled daily series. */
export function sumLastDays(series: Array<{ count: number }>, days: number): number {
  return series.slice(-days).reduce((total, p) => total + p.count, 0)
}
