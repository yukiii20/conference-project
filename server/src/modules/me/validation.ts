import { z } from 'zod'
import { nameSchema, phoneSchema } from '../auth/validation.js'

// See the ordering note in conferences/manage.validation.ts: `.optional()`
// must be applied last, or an absent key gets forced to null and silently
// wipes other fields on this same profile row.
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
}

// Deliberately no `email` or `status` field — those cannot be changed here.
export const updateMyProfileSchema = z.object({
  full_name: nameSchema.optional(),
  phone: phoneSchema.optional(),
  institution: optionalText(300, 'Institution'),
  department: optionalText(300, 'Department'),
  position: optionalText(200, 'Position'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v, ctx) => {
      if (v === '') return null
      if (!/^[A-Z]{2}$/.test(v)) {
        ctx.addIssue({ code: 'custom', message: 'Use a 2-letter country code, e.g. NP.' })
        return z.NEVER
      }
      return v
    })
    .nullable()
    .optional(),
  orcid: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null
      if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(v)) {
        ctx.addIssue({ code: 'custom', message: 'Use the format 0000-0000-0000-000X.' })
        return z.NEVER
      }
      return v
    })
    .nullable()
    .optional(),
  bio: optionalText(1000, 'Bio'),
})
export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>
