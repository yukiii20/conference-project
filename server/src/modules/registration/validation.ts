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

export const registerSchema = z.object({
  category_id: z.string().uuid('Choose a category.'),
})
export type RegisterInput = z.infer<typeof registerSchema>

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
