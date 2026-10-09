import { z } from 'zod'
import { LOGIN_ROLE_CODES, SIGNUP_ROLE_CODES } from './roles'

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

export const loginRoleSchema = z
  .string()
  .min(1, 'Choose a role.')
  .refine((value) => (LOGIN_ROLE_CODES as readonly string[]).includes(value), 'Choose a valid role.')

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
  role: loginRoleSchema,
})

export type LoginInput = z.input<typeof loginSchema>

export const superAdminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
})

export type SuperAdminLoginInput = z.input<typeof superAdminLoginSchema>

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

const optionalContactEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'Enter a valid email address.')

const optionalContactPhone = z.string().trim().transform((v, ctx) => {
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
})

const optionalWebsiteUrl = z.string().trim().transform((v, ctx) => {
  if (v === '') return null
  if (!/^https?:\/\//i.test(v)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Website must start with http:// or https://.' })
    return z.NEVER
  }
  return v
})

/** A2.1 — Conference details tab. Code is read-only and not part of this form. */
export const conferenceDetailsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, 'Name must be at least 3 characters.')
      .max(300, 'Name must be 300 characters or fewer.'),
    short_name: optionalTrimmed(50, 'Short name'),
    theme: optionalTrimmed(300, 'Theme'),
    description: optionalTrimmed(5000, 'Description'),
    start_date: z.string().min(1, 'Start date is required.'),
    end_date: z.string().min(1, 'End date is required.'),
    contact_email: optionalContactEmail,
    contact_phone: optionalContactPhone,
    website_url: optionalWebsiteUrl,
  })
  .superRefine((data, ctx) => {
    if (data.end_date < data.start_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date must be on or after the start date.',
        path: ['end_date'],
      })
    }
  })

export type ConferenceDetailsInput = z.input<typeof conferenceDetailsSchema>

/** A2.3 — Location tab. */
export const locationSchema = z.object({
  venue_name: optionalTrimmed(300, 'Venue name'),
  address: optionalTrimmed(500, 'Address'),
  city: optionalTrimmed(120, 'City'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'Use a 2-letter country code, e.g. NP.'),
  location_map_url: z.string().trim().transform((v, ctx) => {
    if (v === '') return null
    if (!/^https:\/\//i.test(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Paste the embed URL — it must start with https://.' })
      return z.NEVER
    }
    return v
  }),
})

export type LocationInput = z.input<typeof locationSchema>

/** A2.6 — Supporters tab. */
export const SUPPORTER_TIERS = ['organizer', 'co_organizer', 'sponsor', 'partner', 'media'] as const
export type SupporterTier = (typeof SUPPORTER_TIERS)[number]

export const supporterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(200, 'Name must be 200 characters or fewer.'),
  tier: z.enum(SUPPORTER_TIERS),
  website_url: optionalWebsiteUrl,
  display_order: z.coerce.number().int('Whole numbers only.'),
  is_active: z.boolean(),
})

export type SupporterInput = z.input<typeof supporterSchema>

/** A2.5 — Tracks tab. */
export const trackSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(150, 'Name must be 150 characters or fewer.'),
  code: optionalTrimmed(20, 'Code'),
  description: optionalTrimmed(2000, 'Description'),
})

export type TrackInput = z.input<typeof trackSchema>

/** A2.7 — Programme tab: rooms. */
export const roomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Room name is required.')
    .max(150, 'Room name must be 150 characters or fewer.'),
  building: optionalTrimmed(150, 'Building'),
  capacity: z.string().trim().transform((v, ctx) => {
    if (v === '') return null
    const n = Number(v)
    if (!Number.isInteger(n) || n <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Capacity must be a positive whole number.' })
      return z.NEVER
    }
    return n
  }),
})

export type RoomInput = z.input<typeof roomSchema>

/** A2.7 — Programme tab: sessions. */
export const SESSION_TYPES = [
  'paper',
  'keynote',
  'panel',
  'workshop',
  'poster',
  'opening',
  'closing',
  'break',
] as const
export const SESSION_STATUSES = ['draft', 'published'] as const

export const sessionSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'Title must be at least 3 characters.')
      .max(300, 'Title must be 300 characters or fewer.'),
    session_type: z.enum(SESSION_TYPES),
    track_id: z.string().trim().transform((v) => (v === '' ? null : v)),
    room_id: z.string().min(1, 'Choose a room.').uuid('Choose a room.'),
    starts_at: z.string().min(1, 'Start time is required.'),
    ends_at: z.string().min(1, 'End time is required.'),
    status: z.enum(SESSION_STATUSES),
  })
  .superRefine((data, ctx) => {
    if (data.ends_at <= data.starts_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End time must be after the start time.',
        path: ['ends_at'],
      })
    }
  })

export type SessionInput = z.input<typeof sessionSchema>

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Today's date as a local YYYY-MM-DD string, matching <input type="date"> values. */
export function todayDateString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export const newConferenceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, 'Name must be at least 3 characters.')
      .max(300, 'Name must be 300 characters or fewer.'),
    short_name: z
      .string()
      .trim()
      .min(2, 'Short name must be at least 2 characters.')
      .max(50, 'Short name must be 50 characters or fewer.'),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,20}$/, 'Use 2-20 uppercase letters or numbers.'),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, 'Slug must be at least 2 characters.')
      .max(80, 'Slug must be 80 characters or fewer.')
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens.'),
    start_date: z.string().min(1, 'Start date is required.'),
    end_date: z.string().min(1, 'End date is required.'),
    city: optionalTrimmed(120, 'City'),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .length(2, 'Use a 2-letter country code, e.g. NP.'),
    timezone: z.string().trim().min(1, 'Timezone is required.').max(60, 'Timezone must be 60 characters or fewer.'),
  })
  .superRefine((data, ctx) => {
    if (data.start_date < todayDateString()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Start date cannot be before today.',
        path: ['start_date'],
      })
    }
    if (data.end_date < data.start_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date must be on or after the start date.',
        path: ['end_date'],
      })
    }
  })

export type NewConferenceInput = z.input<typeof newConferenceSchema>

export const inviteConvenorSchema = z.object({
  conference_id: z.string().min(1, 'Choose a conference.').uuid('Choose a conference.'),
  full_name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
})

export type InviteConvenorInput = z.input<typeof inviteConvenorSchema>

// Change-password (logged in, no current password needed) uses the same
// shape as reset-password, so it reuses resetPasswordSchema directly.

// ---------------------------------------------------------------------------
// Part B: submissions, reviews, decisions
// ---------------------------------------------------------------------------

export const PRESENTATION_PREFERENCES = ['oral', 'poster', 'either'] as const

export const keywordsSchema = z
  .array(z.string().trim().min(1).max(40))
  .min(1, 'Add at least one keyword.')
  .max(10, 'Up to 10 keywords.')

/** Abstract form, parameterised by the conference's max-words setting. */
export function buildSubmissionSchema(maxWords: number) {
  return z.object({
    track_id: z.string().min(1, 'Choose a track.').uuid('Choose a track.'),
    title: z
      .string()
      .trim()
      .min(5, 'Title must be at least 5 characters.')
      .max(300, 'Title must be 300 characters or fewer.'),
    abstract: z
      .string()
      .trim()
      .min(1, 'Abstract is required.')
      .superRefine((value, ctx) => {
        const words = value.split(/\s+/).filter(Boolean).length
        if (words > maxWords) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Abstract must be ${maxWords} words or fewer (currently ${words}).`,
          })
        }
      }),
    keywords: keywordsSchema,
    presentation_preference: z.enum(PRESENTATION_PREFERENCES),
  })
}

export type SubmissionInput = {
  track_id: string
  title: string
  abstract: string
  keywords: string[]
  presentation_preference: (typeof PRESENTATION_PREFERENCES)[number]
}

export const coAuthorSchema = z.object({
  full_name: nameSchema,
  email: emailSchema,
  affiliation: optionalTrimmed(200, 'Affiliation'),
  country: optionalTrimmed(100, 'Country'),
  is_corresponding: z.boolean(),
})

export type CoAuthorInput = z.input<typeof coAuthorSchema>

const reviewScore = z.coerce
  .number()
  .int('Whole numbers only.')
  .min(1, 'Score must be between 1 and 5.')
  .max(5, 'Score must be between 1 and 5.')

export const RECOMMENDATIONS = ['accept', 'minor_revision', 'major_revision', 'reject'] as const

export const reviewFormSchema = z.object({
  originality: reviewScore,
  quality: reviewScore,
  relevance: reviewScore,
  methodology: reviewScore,
  overall_score: reviewScore,
  confidence: reviewScore,
  recommendation: z.enum(RECOMMENDATIONS),
  comments_to_author: z
    .string()
    .trim()
    .min(10, 'Add comments for the author (at least 10 characters).')
    .max(5000, 'Comments must be 5000 characters or fewer.'),
  confidential_comments: optionalTrimmed(5000, 'Confidential comments'),
})

export type ReviewFormInput = z.input<typeof reviewFormSchema>

export const assignReviewerSchema = z.object({
  reviewer_id: z.string().min(1, 'Choose a reviewer.').uuid('Choose a reviewer.'),
  due_at: z.string().min(1, 'Choose a due date.'),
})

export type AssignReviewerInput = z.input<typeof assignReviewerSchema>

export const DECISIONS = ['accepted', 'rejected', 'revision_required'] as const
export const DECISION_STAGES = ['abstract', 'full_paper', 'final_approval'] as const

export const decisionSchema = z.object({
  decision: z.enum(DECISIONS),
  stage: z.enum(DECISION_STAGES),
  comments_to_author: z
    .string()
    .trim()
    .min(5, 'Add comments for the author.')
    .max(5000, 'Comments must be 5000 characters or fewer.'),
})

export type DecisionInput = z.input<typeof decisionSchema>

// ---------------------------------------------------------------------------
// Part A2: per-conference branding
// ---------------------------------------------------------------------------

export const brandingSchema = z.object({
  tagline: optionalTrimmed(200, 'Tagline'),
  primary_color: z.string().trim().transform((v, ctx) => {
    if (v === '') return null
    if (!/^#[0-9A-Fa-f]{6}$/.test(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a 6-digit hex color, e.g. #2747A0.' })
      return z.NEVER
    }
    return v.toUpperCase()
  }),
})

export type BrandingInput = z.input<typeof brandingSchema>

// ---------------------------------------------------------------------------
// My profile
// ---------------------------------------------------------------------------

export const orcidSchema = z.string().trim().transform((v, ctx) => {
  if (v === '') return null
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(v)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use the format 0000-0000-0000-000X.' })
    return z.NEVER
  }
  return v
})

export const profileSchema = z.object({
  full_name: nameSchema,
  phone: phoneSchema,
  institution: optionalTrimmed(300, 'Institution'),
  department: optionalTrimmed(300, 'Department'),
  position: optionalTrimmed(200, 'Position'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'Choose a country.'),
  orcid: orcidSchema,
  bio: optionalTrimmed(1000, 'Bio'),
})

export type ProfileInput = z.input<typeof profileSchema>

// ---------------------------------------------------------------------------
// Part A3: submission-portal page texts
// ---------------------------------------------------------------------------

export const portalTextsSchema = z.object({
  welcome_text: optionalTrimmed(3000, 'Welcome text'),
  submission_guidelines: optionalTrimmed(10000, 'Submission guidelines'),
})

export type PortalTextsInput = z.input<typeof portalTextsSchema>

// ---------------------------------------------------------------------------
// Convenor portal — dashboard, members, committees, speakers, announcements,
// email templates
// ---------------------------------------------------------------------------

export const reviewSettingsSchema = z.object({
  review_mode: z.enum(['open', 'single_blind', 'double_blind']),
  reviews_required: z.coerce.number().int().min(1, 'At least 1.').max(10, 'At most 10.'),
  max_submissions_per_author: z.coerce.number().int().positive().nullable(),
  max_abstract_words: z.coerce.number().int().min(50, 'At least 50.').max(2000, 'At most 2000.'),
  max_file_size_mb: z.coerce.number().int().min(1, 'At least 1.').max(100, 'At most 100.'),
  allowed_file_types: z.array(z.string().trim().toLowerCase().min(1).max(20)).min(1, 'Allow at least one file type.'),
  authors_see_review_comments: z.boolean(),
})
export type ReviewSettingsInput = z.input<typeof reviewSettingsSchema>

export const ASSIGNABLE_MEMBER_ROLES = ['reviewer', 'session_chair', 'staff', 'manager'] as const

export const inviteMemberSchema = z.object({
  full_name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  role_code: z.enum(ASSIGNABLE_MEMBER_ROLES),
})
export type InviteMemberInput = z.input<typeof inviteMemberSchema>

export const COMMITTEE_TYPES = ['organizing', 'program', 'technical', 'review', 'registration', 'advisory', 'other'] as const
export const COMMITTEE_MEMBER_ROLES = ['chair', 'co_chair', 'secretary', 'member'] as const

export const committeeSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(200, 'Name must be 200 characters or fewer.'),
  committee_type: z.enum(COMMITTEE_TYPES),
  description: optionalTrimmed(5000, 'Description'),
  is_public: z.boolean(),
})
export type CommitteeInput = z.input<typeof committeeSchema>

export const committeeMemberSchema = z
  .object({
    user_id: z.string().trim().uuid().optional().or(z.literal('')),
    display_name: z.string().trim().max(200).optional().or(z.literal('')),
    affiliation: optionalTrimmed(300, 'Affiliation'),
    country: z.string().trim().max(2).optional().or(z.literal('')),
    member_role: z.enum(COMMITTEE_MEMBER_ROLES),
  })
  .refine((v) => Boolean(v.user_id) || Boolean(v.display_name), {
    message: 'Pick an existing user or type a name.',
    path: ['display_name'],
  })
export type CommitteeMemberInput = z.input<typeof committeeMemberSchema>

export const SPEAKER_TYPES = ['keynote', 'invited', 'panelist', 'guest'] as const

export const speakerSchema = z.object({
  full_name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(200, 'Name must be 200 characters or fewer.'),
  designation: optionalTrimmed(200, 'Designation'),
  affiliation: optionalTrimmed(300, 'Affiliation'),
  bio: optionalTrimmed(5000, 'Bio'),
  speaker_type: z.enum(SPEAKER_TYPES),
  is_public: z.boolean(),
})
export type SpeakerInput = z.input<typeof speakerSchema>

export const ANNOUNCEMENT_AUDIENCES = ['all', 'authors', 'reviewers', 'session_chairs', 'staff'] as const

export const announcementSchema = z.object({
  title: z.string().trim().min(2, 'Title must be at least 2 characters.').max(200, 'Title must be 200 characters or fewer.'),
  body: z.string().trim().min(1, 'Write the announcement.').max(10_000, 'Body must be 10,000 characters or fewer.'),
  audience: z.array(z.enum(ANNOUNCEMENT_AUDIENCES)).min(1, 'Choose at least one audience.'),
  status: z.enum(['draft', 'scheduled', 'published']),
  publish_at: z.string().optional(),
  send_email: z.boolean(),
})
export type AnnouncementInput = z.input<typeof announcementSchema>

export const emailTemplateSchema = z.object({
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters.').max(300, 'Subject must be 300 characters or fewer.'),
  body_html: z.string().trim().min(1, 'Write the email body.').max(20_000, 'Body must be 20,000 characters or fewer.'),
})
export type EmailTemplateInput = z.input<typeof emailTemplateSchema>
