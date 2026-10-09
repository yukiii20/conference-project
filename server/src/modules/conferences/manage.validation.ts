import { z } from 'zod'
import { normalizePhone } from '../../utils/phone.js'

// IMPORTANT: `.optional()`/`.nullable()` must be the OUTERMOST wrapper (applied
// last) on every field below. Zod only short-circuits "key absent from the
// request body" -> stays absent in the parsed output when ZodOptional/
// ZodNullable is the outermost type; a `.transform()` applied *after*
// `.optional()` runs even when the key is missing and injects the key back
// into the output as null, which would silently wipe every other section's
// fields on a partial PATCH. (Verified against the installed zod version —
// this is not hypothetical.)
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
}

const optionalContactEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v, ctx) => {
    if (v === '') return null
    if (!z.string().email().safeParse(v).success) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email address.' })
      return z.NEVER
    }
    return v
  })
  .nullable()
  .optional()

const optionalContactPhone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null
    const normalized = normalizePhone(v)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a Nepal mobile number, e.g. 98XXXXXXXX or +97798XXXXXXXX.' })
      return z.NEVER
    }
    return normalized
  })
  .nullable()
  .optional()

const optionalWebsiteUrl = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null
    if (!/^https?:\/\//i.test(v)) {
      ctx.addIssue({ code: 'custom', message: 'Website must start with http:// or https://.' })
      return z.NEVER
    }
    return v
  })
  .nullable()
  .optional()

const optionalMapUrl = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null
    if (!/^https:\/\//i.test(v)) {
      ctx.addIssue({ code: 'custom', message: 'Paste the embed URL — it must start with https://.' })
      return z.NEVER
    }
    return v
  })
  .nullable()
  .optional()

const optionalColor = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null
    if (!/^#[0-9A-Fa-f]{6}$/.test(v)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a 6-digit hex color, e.g. #2747A0.' })
      return z.NEVER
    }
    return v.toUpperCase()
  })
  .nullable()
  .optional()

const optionalCountry = z
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
  .optional()

export const updateConferenceSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,20}$/, 'Use 2-20 uppercase letters or numbers.')
    .optional(),
  name: z.string().trim().min(3, 'Name must be at least 3 characters.').max(300).optional(),
  short_name: optionalText(50, 'Short name'),
  tagline: optionalText(200, 'Tagline'),
  theme: optionalText(300, 'Theme'),
  description: optionalText(5000, 'Description'),
  welcome_text: optionalText(3000, 'Welcome text'),
  submission_guidelines: optionalText(10000, 'Submission guidelines'),
  primary_color: optionalColor,
  venue_name: optionalText(300, 'Venue name'),
  address: optionalText(500, 'Address'),
  city: optionalText(120, 'City'),
  country: optionalCountry,
  location_map_url: optionalMapUrl,
  contact_email: optionalContactEmail,
  contact_phone: optionalContactPhone,
  website_url: optionalWebsiteUrl,
  start_date: z.string().trim().min(1).optional(),
  end_date: z.string().trim().min(1).optional(),
})

export type UpdateConferenceInput = z.infer<typeof updateConferenceSchema>
