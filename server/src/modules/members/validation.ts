import { z } from 'zod'
import { emailSchema, nameSchema, phoneSchema } from '../auth/validation.js'

/** Roles assignable here. Convenor is appointed only via the admin flow (one active per conference); author is self-signup. */
export const ASSIGNABLE_ROLES = ['reviewer', 'session_chair', 'staff', 'manager'] as const
export const MEMBER_ROLE_FILTER = ['author', 'reviewer', 'session_chair', 'staff', 'manager', 'convenor'] as const

export const listMembersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  role: z.enum(MEMBER_ROLE_FILTER).optional(),
})
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>

export const changeRoleSchema = z.object({
  role_code: z.enum(ASSIGNABLE_ROLES),
})
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>

export const setMaxReviewLoadSchema = z.object({
  max_review_load: z.number().int().positive().nullable(),
})
export type SetMaxReviewLoadInput = z.infer<typeof setMaxReviewLoadSchema>

export const inviteMemberSchema = z.object({
  full_name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  role_code: z.enum(ASSIGNABLE_ROLES),
})
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

export const setReviewerTracksSchema = z.object({
  track_ids: z.array(z.string().uuid()),
})
export type SetReviewerTracksInput = z.infer<typeof setReviewerTracksSchema>
