import { describe, expect, it } from 'vitest'
import { paymentSchema, reasonSchema, registrationFeeSchema } from '../src/modules/registration/validation.js'

const base = { amount: '1500.456', currency: ' npr ', valid_from: '2026-11-01T00:00:00+05:45', valid_until: '2026-11-30T23:59:00+05:45' }

describe('registrationFeeSchema', () => {
  it('normalises currency, rounds to paisa, parses dates with offsets', () => {
    const r = registrationFeeSchema.parse(base)
    expect(r).toMatchObject({ amount: 1500.46, currency: 'NPR', fee_type: 'regular', is_active: true })
    expect(r.valid_from.toISOString()).toBe('2026-10-31T18:15:00.000Z')
  })
  it('rejects end <= start, negative amounts, bad currency and bad dates', () => {
    expect(registrationFeeSchema.safeParse({ ...base, valid_until: base.valid_from }).success).toBe(false)
    expect(registrationFeeSchema.safeParse({ ...base, amount: -1 }).success).toBe(false)
    expect(registrationFeeSchema.safeParse({ ...base, currency: 'RS' }).success).toBe(false)
    expect(registrationFeeSchema.safeParse({ ...base, valid_from: 'tomorrow' }).success).toBe(false)
  })
  it('allows a free (0) price', () => {
    expect(registrationFeeSchema.safeParse({ ...base, amount: 0 }).success).toBe(true)
  })
})

describe('paymentSchema / reasonSchema', () => {
  it('requires a positive amount and a known method', () => {
    expect(paymentSchema.safeParse({ amount: 100, method: 'cash' }).success).toBe(true)
    expect(paymentSchema.safeParse({ amount: 0, method: 'cash' }).success).toBe(false)
    expect(paymentSchema.safeParse({ amount: 10, method: 'paypal' }).success).toBe(false)
  })
  it('turns an empty reference into null', () => {
    expect(paymentSchema.parse({ amount: 1, method: 'esewa', reference: '  ' }).reference).toBeNull()
  })
  it('needs a short reason', () => {
    expect(reasonSchema.safeParse({ reason: 'ok' }).success).toBe(false)
    expect(reasonSchema.safeParse({ reason: 'Invited speaker' }).success).toBe(true)
  })
})
