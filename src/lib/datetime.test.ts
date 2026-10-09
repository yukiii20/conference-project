import { describe, expect, it } from 'vitest'
import {
  formatDateRange,
  formatKathmandu,
  formatKathmanduTime,
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
