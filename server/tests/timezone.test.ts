import { describe, expect, it } from 'vitest'
import { resolveRange } from '../src/modules/analytics/service.js'
import { formatIssued } from '../src/modules/certificates/export.js'
import { addDaysToDateKey, localDateKey, weekStartKey } from '../src/utils/timezone.js'

// 2026-11-01 20:30 UTC is 2026-11-02 02:15 in Kathmandu (UTC+5:45).
const LATE_UTC = new Date('2026-11-01T20:30:00Z')

describe('Nepal-time dates', () => {
  it('"today" follows Kathmandu, not UTC', () => {
    expect(localDateKey('Asia/Kathmandu', LATE_UTC)).toBe('2026-11-02')
    expect(resolveRange({}, 'Asia/Kathmandu', LATE_UTC)).toEqual({ from: '2026-10-04', to: '2026-11-02' })
  })
  it('keeps an explicit range untouched', () => {
    expect(resolveRange({ from: '2026-01-01', to: '2026-01-31' }, 'Asia/Kathmandu', LATE_UTC)).toEqual({ from: '2026-01-01', to: '2026-01-31' })
  })
  it('date-key arithmetic crosses month and year ends', () => {
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('weeks start on Sunday', () => {
    expect(weekStartKey('2026-11-01')).toBe('2026-11-01') // Sunday
    expect(weekStartKey('2026-11-04')).toBe('2026-11-01')
    expect(weekStartKey('2026-11-07')).toBe('2026-11-01')
    expect(weekStartKey('2026-11-08')).toBe('2026-11-08')
  })
  it('certificate issue date is the Nepal date', () => {
    expect(formatIssued(LATE_UTC)).toBe('2 November 2026')
    expect(formatIssued(LATE_UTC, 'UTC')).toBe('1 November 2026')
  })
})
