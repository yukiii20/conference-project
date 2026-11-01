import { z } from 'zod'

function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
}

export const registrationCategorySchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{2,40}$/, 'Code must be 2-40 lowercase letters, digits or underscores.'),
  name: z.string().trim().min(1, 'Name is required.').max(100, 'Name must be 100 characters or fewer.'),
  description: optionalText(500, 'Description'),
  is_active: z.boolean().default(true),
  display_order: z.coerce.number().int().default(0),
})
export type RegistrationCategoryInput = z.infer<typeof registrationCategorySchema>

const isoDateTime = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .datetime({ offset: true, message: `${label} must be a valid date and time.` })
    .transform((v) => new Date(v))

const money = z.coerce
  .number({ error: 'Amount must be a number.' })
  .min(0, 'Amount cannot be negative.')
  .max(9_999_999_999, 'Amount is too large.')
  .transform((v) => Math.round(v * 100) / 100)

export const registrationFeeSchema = z
  .object({
    fee_type: z.enum(['early_bird', 'regular', 'late', 'on_site']).default('regular'),
    amount: money,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code such as NPR or USD.'),
    valid_from: isoDateTime('Start'),
    valid_until: isoDateTime('End'),
    is_active: z.boolean().default(true),
  })
  .refine((v) => v.valid_until > v.valid_from, { message: 'The end must be after the start.', path: ['valid_until'] })
export type RegistrationFeeInput = z.infer<typeof registrationFeeSchema>

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'esewa', 'khalti', 'fonepay', 'other'] as const

export const paymentSchema = z.object({
  amount: money.refine((v) => v > 0, 'Amount must be more than 0.'),
  method: z.enum(PAYMENT_METHODS, { error: 'Choose how it was paid.' }),
  reference: optionalText(200, 'Reference'),
  paid_at: isoDateTime('Paid at').optional(),
})
export type PaymentInput = z.infer<typeof paymentSchema>

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason.').max(500, 'Reason must be 500 characters or fewer.'),
})

export const registerSchema = z.object({
  category_id: z.string().uuid('Choose a category.'),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const checkinLookupQuerySchema = z
  .object({
    code: z.string().trim().min(1).max(60).optional(),
    qr_token: z.string().trim().min(1).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.qr_token), {
    message: 'Provide either a ticket code or a qr_token, not both.',
  })
export type CheckinLookupQuery = z.infer<typeof checkinLookupQuerySchema>

export const checkinSchema = z.object({
  qr_token: z.string().trim().min(1, 'Scan or enter a QR token.'),
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
    .optional(),
})
export type CheckinInput = z.infer<typeof checkinSchema>

export const manualCheckinSchema = z.object({
  registration_id: z.string().uuid(),
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
    .optional(),
})
export type ManualCheckinInput = z.infer<typeof manualCheckinSchema>

export const sessionCheckinSchema = z.object({
  qr_token: z.string().trim().min(1, 'Scan or enter a QR token.'),
})
export type SessionCheckinInput = z.infer<typeof sessionCheckinSchema>

export const manualSessionCheckinSchema = z.object({
  registration_id: z.string().uuid(),
})
export type ManualSessionCheckinInput = z.infer<typeof manualSessionCheckinSchema>
