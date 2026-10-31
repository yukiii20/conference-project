import { describe, expect, it } from 'vitest'
import { relativeTime, sumLastDays } from './relativeTime'

const now = new Date('2026-10-31T12:00:00Z').getTime()

describe('relativeTime', () => {
  it('handles empty and invalid input', () => {
    expect(relativeTime(null, now)).toBe('')
    expect(relativeTime('not a date', now)).toBe('')
  })

  it('formats past and future times', () => {
    expect(relativeTime('2026-10-31T11:59:40Z', now)).toBe('just now')
    expect(relativeTime('2026-10-31T11:50:00Z', now)).toBe('10 minutes ago')
    expect(relativeTime('2026-10-31T09:00:00Z', now)).toBe('3 hours ago')
    expect(relativeTime('2026-10-30T12:00:00Z', now)).toBe('yesterday')
    expect(relativeTime('2026-11-05T12:00:00Z', now)).toBe('in 5 days')
    expect(relativeTime('2026-11-30T12:00:00Z', now)).toBe('next month')
  })
})

describe('sumLastDays', () => {
  it('sums the tail of a series', () => {
    const series = [1, 2, 3, 4, 5].map((count) => ({ count }))
    expect(sumLastDays(series, 2)).toBe(9)
    expect(sumLastDays(series, 10)).toBe(15)
    expect(sumLastDays([], 7)).toBe(0)
  })
})
