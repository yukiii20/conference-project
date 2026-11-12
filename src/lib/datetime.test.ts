import { describe, expect, it } from 'vitest'
import {
  formatDateRange,
  formatKathmandu,
  formatKathmanduTime,
  kathmanduToday,
  fromKathmanduDateInputValue,
  fromKathmanduInputValue,
  kathmanduDateKey,
  toKathmanduDateInputValue,
  toKathmanduInputValue,
} from './datetime'

describe('toKathmanduInputValue', () => {
  it('returns an empty string for null', () => {
    expect(toKathmanduInputValue(null)).toBe('')
  })

  it('returns an empty string for an invalid ISO string (does not throw)', () => {
    expect(() => toKathmanduInputValue('not-a-date')).not.toThrow()
    expect(toKathmanduInputValue('not-a-date')).toBe('')
  })

  it('shifts UTC midnight to the Kathmandu wall clock (+5:45)', () => {
    expect(toKathmanduInputValue('2026-01-15T00:00:00Z')).toBe('2026-01-15T05:45')
  })

  it('rolls over to the next day when the offset crosses midnight', () => {
    expect(toKathmanduInputValue('2026-01-15T20:00:00Z')).toBe('2026-01-16T01:45')
  })
})

describe('fromKathmanduInputValue', () => {
  it('returns null for an empty string', () => {
    expect(fromKathmanduInputValue('')).toBeNull()
  })

  it('returns null for an unparsable value', () => {
    expect(fromKathmanduInputValue('not-a-date')).toBeNull()
  })

  it('round-trips with toKathmanduInputValue', () => {
    const original = '2026-01-15T00:00:00.000Z'
    const local = toKathmanduInputValue(original)
    expect(fromKathmanduInputValue(local)).toBe(original)
  })
})

describe('toKathmanduDateInputValue / fromKathmanduDateInputValue', () => {
  it('returns an empty string / null for missing input', () => {
    expect(toKathmanduDateInputValue(null)).toBe('')
    expect(fromKathmanduDateInputValue('')).toBeNull()
  })

  it('extracts just the date part in Kathmandu time', () => {
    expect(toKathmanduDateInputValue('2026-01-15T20:00:00Z')).toBe('2026-01-16')
  })

  it('converts a bare date back to a UTC instant at Kathmandu midnight', () => {
    expect(fromKathmanduDateInputValue('2026-01-15')).toBe('2026-01-14T18:15:00.000Z')
  })
})

describe('formatKathmandu', () => {
  it('shows an em dash for null', () => {
    expect(formatKathmandu(null)).toBe('—')
  })

  it('shows an em dash for an invalid ISO string (does not throw)', () => {
    expect(() => formatKathmandu('not-a-date')).not.toThrow()
    expect(formatKathmandu('not-a-date')).toBe('—')
  })

  it('formats a single point in time with date and time', () => {
    const result = formatKathmandu('2026-01-15T00:00:00Z')
    expect(result).toContain('15 Jan 2026')
    expect(result.toLowerCase()).toMatch(/am|pm/)
  })

  it('formats dateOnly without a time component', () => {
    const result = formatKathmandu('2026-01-15T00:00:00Z', { dateOnly: true })
    expect(result).toBe('15 Jan 2026')
    expect(result.toLowerCase()).not.toMatch(/am|pm/)
  })
})

describe('formatKathmanduTime', () => {
  it('does not throw on an invalid ISO string', () => {
    expect(() => formatKathmanduTime('not-a-date')).not.toThrow()
    expect(formatKathmanduTime('not-a-date')).toBe('—')
  })

  it('formats the time only, in Kathmandu local time', () => {
    expect(formatKathmanduTime('2026-01-15T00:00:00Z').toLowerCase()).toContain('5:45')
  })
})

describe('kathmanduDateKey', () => {
  it('matches toKathmanduDateInputValue', () => {
    expect(kathmanduDateKey('2026-01-15T20:00:00Z')).toBe('2026-01-16')
  })
})

describe('formatDateRange', () => {
  it('formats a single date (start === end)', () => {
    expect(formatDateRange('2026-11-15', '2026-11-15')).toBe('15 November 2026')
  })

  it('formats a range within the same month', () => {
    expect(formatDateRange('2026-11-15', '2026-11-17')).toBe('15–17 November 2026')
  })

  it('formats a range spanning two months', () => {
    expect(formatDateRange('2026-11-30', '2026-12-02')).toBe('30 November 2026 – 2 December 2026')
  })

  it('formats a range spanning two years', () => {
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('30 December 2026 – 2 January 2027')
  })
})

describe('kathmanduToday', () => {
  // 20:30 UTC on 1 Nov is 02:15 on 2 Nov in Kathmandu (UTC+5:45).
  const late = new Date('2026-11-01T20:30:00Z')
  it('uses the Kathmandu date, not the UTC date', () => {
    expect(kathmanduToday(0, late)).toBe('2026-11-02')
  })
  it('shifts across month ends', () => {
    expect(kathmanduToday(-29, late)).toBe('2026-10-04')
    expect(kathmanduToday(30, late)).toBe('2026-12-02')
  })
})

describe('Kathmandu input helpers: edge cases (one shared helper for every date field)', () => {
  it('midnight Nepal time is 18:15 UTC the day before, and round-trips', () => {
    expect(fromKathmanduInputValue('2026-11-15T00:00')).toBe('2026-11-14T18:15:00.000Z')
    expect(toKathmanduInputValue('2026-11-14T18:15:00.000Z')).toBe('2026-11-15T00:00')
  })

  it('end of day (23:59) stays on the same Nepal date', () => {
    expect(fromKathmanduInputValue('2026-11-15T23:59')).toBe('2026-11-15T18:14:00.000Z')
    expect(toKathmanduDateInputValue('2026-11-15T18:14:00.000Z')).toBe('2026-11-15')
  })

  it('a date-only value means midnight Nepal time', () => {
    expect(fromKathmanduDateInputValue('2026-11-15')).toBe('2026-11-14T18:15:00.000Z')
    expect(fromKathmanduDateInputValue('')).toBeNull()
  })

  it('has no daylight saving: the same +5:45 offset in January and July', () => {
    expect(fromKathmanduInputValue('2026-01-15T12:00')).toBe('2026-01-15T06:15:00.000Z')
    expect(fromKathmanduInputValue('2026-07-15T12:00')).toBe('2026-07-15T06:15:00.000Z')
  })

  it('round-trips every quarter hour of a day without drifting', () => {
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const local = `2026-03-29T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
      expect(toKathmanduInputValue(fromKathmanduInputValue(local))).toBe(local)
    }
  })

  it('rejects a half-typed value', () => {
    expect(fromKathmanduInputValue('2026-11-15')).toBeNull()
    expect(fromKathmanduInputValue('')).toBeNull()
  })
})
