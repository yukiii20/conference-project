import { z } from 'zod'
import { normalizePhone } from '../../utils/phone.js'

export const SIGNUP_ROLE_CODES = ['author', 'reviewer', 'session_chair', 'staff', 'manager'] as const
export type SignupRoleCode = (typeof SIGNUP_ROLE_CODES)[number]

export const LOGIN_ROLE_CODES = ['author', 'reviewer', 'session_chair', 'staff', 'manager', 'convenor'] as const
export type LoginRoleCode = (typeof LOGIN_ROLE_CODES)[number]

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

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required.')
  .transform((value, ctx) => {
    const normalized = normalizePhone(value)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a Nepal mobile number, e.g. 98XXXXXXXX or +97798XXXXXXXX.' })
      return z.NEVER
    }
    return normalized
  })

const PASSWORD_RULES: Array<{ label: string; test: (p: string) => boolean }> = [
  { label: 'at least 8 characters', test: (p) => p.length >= 8 },
  { label: 'one uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'one lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'one number', test: (p) => /[0-9]/.test(p) },
  { label: 'one symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
]

export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const rule of PASSWORD_RULES) {
    if (!rule.test(value)) {
      ctx.addIssue({ code: 'custom', message: `Password needs ${rule.label}.` })
    }
  }
})

/** A conference named by its slug or its id — every sign-in / sign-up / reset call carries one. */
export const conferenceRefSchema = z
  .string({ error: 'Choose a conference.' })
  .trim()
  .min(1, 'Choose a conference.')
  .max(80, 'Choose a conference.')

export const registerSchema = z.object({
  full_name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  requested_role: z.enum(SIGNUP_ROLE_CODES),
  conference_id: z.string().uuid('Choose a conference.'),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
  role: z.enum(LOGIN_ROLE_CODES),
  remember_me: z.boolean().optional().default(true),
  /** Required: a membership only ever works at its own conference. */
  conference: conferenceRefSchema,
})
export type LoginInput = z.infer<typeof loginSchema>

/** Sign-up at a conference with an email that already has an account — proven with that account's current password. */
export const joinConferenceSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter the password of your existing account.'),
  requested_role: z.enum(SIGNUP_ROLE_CODES),
  conference: conferenceRefSchema,
})
export type JoinConferenceInput = z.infer<typeof joinConferenceSchema>

/** A signed-in person asking for a role at another conference. */
export const requestRoleSchema = z.object({
  requested_role: z.enum(SIGNUP_ROLE_CODES),
  conference: conferenceRefSchema,
})
export type RequestRoleInput = z.infer<typeof requestRoleSchema>

export const switchConferenceSchema = z.object({
  conference_id: z.string().uuid('Choose a conference.'),
})
export type SwitchConferenceInput = z.infer<typeof switchConferenceSchema>

export const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
})
export type AdminLoginInput = z.infer<typeof adminLoginSchema>

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required.'),
  new_password: passwordSchema,
})
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  /** Optional: when the request comes from a conference's own page, the email links back to it. */
  conference: conferenceRefSchema.optional(),
})
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required.'),
  password: passwordSchema,
})
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Invitation token is required.'),
  password: passwordSchema,
  /** The conference named in the invitation link; the new session is bound to it if the person holds a role there. */
  conference: conferenceRefSchema.optional(),
})
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>

/** A blank string means "clear this field" (-> NULL), matching the frontend's optionalTrimmed convention. */
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v))
}

export const updateProfileSchema = z.object({
  full_name: nameSchema.optional(),
  phone: phoneSchema.optional(),
  institution: optionalText(300, 'Institution'),
  department: optionalText(300, 'Department'),
  position: optionalText(200, 'Position'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'Use a 2-letter country code, e.g. NP.'),
  orcid: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v))
    .refine((v) => v === null || /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(v), 'Use the format 0000-0000-0000-000X.'),
  bio: optionalText(1000, 'Bio'),
  photo_path: optionalText(500, 'Photo path'),
})
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
