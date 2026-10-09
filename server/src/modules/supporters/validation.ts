import { z } from 'zod'

export const SUPPORTER_TIERS = ['organizer', 'co_organizer', 'sponsor', 'partner', 'media'] as const
export type SupporterTier = (typeof SUPPORTER_TIERS)[number]

// See the comment in conferences/manage.validation.ts: transform must run
// before nullable()/optional() wrap, or an absent key gets forced to null.
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

export const createSupporterSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(200),
  tier: z.enum(SUPPORTER_TIERS),
  website_url: optionalWebsiteUrl,
})
export type CreateSupporterInput = z.infer<typeof createSupporterSchema>

export const updateSupporterSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(200).optional(),
  tier: z.enum(SUPPORTER_TIERS).optional(),
  website_url: optionalWebsiteUrl,
})
export type UpdateSupporterInput = z.infer<typeof updateSupporterSchema>

export const reorderSupportersSchema = z.object({
  tier: z.enum(SUPPORTER_TIERS),
  supporter_ids: z.array(z.string().uuid()).min(1),
})
export type ReorderSupportersInput = z.infer<typeof reorderSupportersSchema>
