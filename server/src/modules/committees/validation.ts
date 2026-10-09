import { z } from 'zod'

export const COMMITTEE_TYPES = [
  'organizing',
  'program',
  'technical',
  'review',
  'registration',
  'advisory',
  'other',
] as const

export const COMMITTEE_MEMBER_ROLES = ['chair', 'co_chair', 'secretary', 'member'] as const

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? undefined : v))

export const createCommitteeSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(200, 'Name must be 200 characters or fewer.'),
  committee_type: z.enum(COMMITTEE_TYPES).default('other'),
  description: optionalTrimmed(5000),
  is_public: z.boolean().default(true),
})
export type CreateCommitteeInput = z.infer<typeof createCommitteeSchema>

export const updateCommitteeSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  committee_type: z.enum(COMMITTEE_TYPES).optional(),
  description: optionalTrimmed(5000),
  is_public: z.boolean().optional(),
})
export type UpdateCommitteeInput = z.infer<typeof updateCommitteeSchema>

export const reorderCommitteesSchema = z.object({
  committee_ids: z.array(z.string().uuid()).min(1),
})

const optionalCountry = z
  .string()
  .trim()
  .length(2)
  .toUpperCase()
  .nullable()
  .optional()
  .transform((v) => (v === '' || v == null ? undefined : v))

export const createCommitteeMemberSchema = z
  .object({
    user_id: z.string().uuid().nullable().optional().transform((v) => v ?? undefined),
    display_name: z.string().trim().min(1).max(200).nullable().optional().transform((v) => (v === '' || v == null ? undefined : v)),
    affiliation: optionalTrimmed(300),
    country: optionalCountry,
    member_role: z.enum(COMMITTEE_MEMBER_ROLES).default('member'),
  })
  .refine((v) => Boolean(v.user_id) || Boolean(v.display_name), {
    message: 'Pick an existing user or type a name.',
    path: ['display_name'],
  })
export type CreateCommitteeMemberInput = z.infer<typeof createCommitteeMemberSchema>

export const updateCommitteeMemberSchema = z.object({
  display_name: z.string().trim().min(1).max(200).optional(),
  affiliation: optionalTrimmed(300),
  country: optionalCountry,
  member_role: z.enum(COMMITTEE_MEMBER_ROLES).optional(),
})
export type UpdateCommitteeMemberInput = z.infer<typeof updateCommitteeMemberSchema>

export const reorderCommitteeMembersSchema = z.object({
  member_ids: z.array(z.string().uuid()).min(1),
})
