import { describe, expect, it } from 'vitest'
import { formatMoney } from './money'

describe('formatMoney', () => {
  it('groups digits the Nepali way and drops .00', () => {
    expect(formatMoney(150000, 'NPR')).toBe('NPR 1,50,000')
    expect(formatMoney('1500.00', 'NPR')).toBe('NPR 1,500')
  })
  it('keeps paisa when there are any', () => {
    expect(formatMoney('1500.5', 'USD')).toBe('USD 1,500.50')
  })
  it('falls back to the raw text for non-numbers', () => {
    expect(formatMoney('n/a', 'NPR')).toBe('NPR n/a')
  })
})
