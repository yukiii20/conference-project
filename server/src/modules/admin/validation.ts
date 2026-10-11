import { z } from 'zod'
import { emailSchema, nameSchema, phoneSchema } from '../auth/validation.js'

function todayDateString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export const createConferenceSchema = z
  .object({
    name: z.string().trim().min(3, 'Name must be at least 3 characters.').max(300),
    short_name: z.string().trim().min(2, 'Short name must be at least 2 characters.').max(50),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/, 'Use 2-20 uppercase letters or numbers.'),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens.'),
    start_date: z.string().min(1, 'Start date is required.'),
    end_date: z.string().min(1, 'End date is required.'),
    city: z.string().trim().max(120).optional().nullable(),
    country: z.string().trim().toUpperCase().length(2, 'Use a 2-letter country code, e.g. NP.'),
    timezone: z.string().trim().min(1).max(60).default('Asia/Kathmandu'),
  })
  .superRefine((data, ctx) => {
    if (data.start_date < todayDateString()) {
      ctx.addIssue({ code: 'custom', message: 'Start date cannot be before today.', path: ['start_date'] })
    }
    if (data.end_date < data.start_date) {
      ctx.addIssue({ code: 'custom', message: 'End date must be on or after the start date.', path: ['end_date'] })
    }
  })
export type CreateConferenceInput = z.infer<typeof createConferenceSchema>

export const appointConvenorSchema = z.object({
  email: emailSchema,
})
export type AppointConvenorInput = z.infer<typeof appointConvenorSchema>

export const convenorInviteSchema = z.object({
  full_name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
})
export type ConvenorInviteInput = z.infer<typeof convenorInviteSchema>

const pageSchema = z.coerce.number().int().min(1).default(1)

export const listUsersQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'suspended', 'deactivated']).optional(),
  page: pageSchema,
})
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>

export const auditLogQuerySchema = z.object({
  actor: z.string().trim().uuid().optional(),
  conference: z.string().trim().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: pageSchema,
})
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>

export const listConferencesQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z
    .enum([
      'draft',
      'registration_open',
      'submission_open',
      'under_review',
      'scheduling',
      'published',
      'ongoing',
      'completed',
      'closed',
    ])
    .optional(),
})
export type ListConferencesQuery = z.infer<typeof listConferencesQuerySchema>

export const grantAdminSchema = z.object({
  email: emailSchema,
})
export type GrantAdminInput = z.infer<typeof grantAdminSchema>
