import { z } from 'zod'
import { SIGNUP_ROLE_CODES } from './roles'

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Full name must be at least 2 characters.')
  .max(100, 'Full name must be 100 characters or fewer.')
  .regex(/^[A-Za-z .'-]+$/, "Use letters, spaces, '.', apostrophes, or hyphens only.")

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase())

/** Normalises a Nepal mobile number (with or without +977) to +977XXXXXXXXXX. */
export function normalizePhone(raw: string): string | null {
  let digits = raw.trim().replace(/[\s-]/g, '').replace(/^\+/, '')
  if (digits.startsWith('977')) {
    digits = digits.slice(3)
  }
  if (/^(97|98)\d{8}$/.test(digits)) {
    return `+977${digits}`
  }
  return null
}

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required.')
  .transform((value, ctx) => {
    const normalized = normalizePhone(value)
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a Nepal mobile number, e.g. 98XXXXXXXX or +97798XXXXXXXX.',
      })
      return z.NEVER
    }
    return normalized
  })

export type PasswordRule = {
  id: string
  label: string
  test: (password: string) => boolean
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: 'One number', test: (p) => /[0-9]/.test(p) },
  { id: 'symbol', label: 'One symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
]

export function getPasswordChecklist(password: string) {
  return PASSWORD_RULES.map((rule) => ({ ...rule, passed: rule.test(password) }))
}

export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const rule of PASSWORD_RULES) {
    if (!rule.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Password needs ${rule.label.toLowerCase()}.` })
    }
  }
})

export const roleSchema = z
  .string()
  .min(1, 'Choose a role.')
  .refine((value) => (SIGNUP_ROLE_CODES as readonly string[]).includes(value), 'Choose a valid role.')

export const signupSchema = z
  .object({
    full_name: nameSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirm_password: z.string().min(1, 'Confirm your password.'),
    role: roleSchema,
    conference_id: z.string().min(1, 'Choose a conference.').uuid('Choose a conference.'),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match.',
        path: ['confirm_password'],
      })
    }
  })

export type SignupInput = z.input<typeof signupSchema>

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
  role: roleSchema,
})

export type LoginInput = z.input<typeof loginSchema>

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm_password: z.string().min(1, 'Confirm your password.'),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match.',
        path: ['confirm_password'],
      })
    }
  })

export type ResetPasswordInput = z.input<typeof resetPasswordSchema>

function optionalTrimmed(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => (v === '' ? null : v))
}

export const conferenceInfoSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Code must be at least 2 characters.')
    .max(20, 'Code must be 20 characters or fewer.')
    .regex(/^[A-Z0-9_-]+$/, 'Use only letters, numbers, hyphens, or underscores.'),
  name: z
    .string()
    .trim()
    .min(3, 'Name must be at least 3 characters.')
    .max(300, 'Name must be 300 characters or fewer.'),
  short_name: optionalTrimmed(50, 'Short name'),
  theme: optionalTrimmed(300, 'Theme'),
  description: optionalTrimmed(5000, 'Description'),
  venue_name: optionalTrimmed(300, 'Venue name'),
  address: optionalTrimmed(500, 'Address'),
  city: optionalTrimmed(120, 'City'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'Use a 2-letter country code, e.g. NP.'),
  contact_email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || z.string().email().safeParse(v).success, 'Enter a valid email address.'),
  contact_phone: z.string().trim().transform((v, ctx) => {
    if (v === '') return null
    const normalized = normalizePhone(v)
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a Nepal mobile number, e.g. 98XXXXXXXX or +97798XXXXXXXX.',
      })
      return z.NEVER
    }
    return normalized
  }),
  website_url: z.string().trim().transform((v, ctx) => {
    if (v === '') return null
    if (!/^https?:\/\//i.test(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Website must start with http:// or https://.' })
      return z.NEVER
    }
    return v
  }),
})

export type ConferenceInfoInput = z.input<typeof conferenceInfoSchema>
