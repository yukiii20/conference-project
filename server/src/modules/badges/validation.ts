import { z } from 'zod'

export const BADGE_ROLES = ['speaker', 'author', 'reviewer', 'staff', 'attendee'] as const
export type BadgeRoleFilter = (typeof BADGE_ROLES)[number]

const uuid = z.string().uuid()

export const badgeFilterQuerySchema = z.object({
  category_id: uuid.optional(),
  role: z.enum(BADGE_ROLES).optional(),
  checked_in_today: z.enum(['1']).optional(),
  not_printed_only: z.enum(['1']).optional(),
  // Comma-separated registration ids — "selected rows" instead of a filter. Validated as a
  // plain string here; split and checked (each a uuid) in the route, since zod's query parsing
  // only ever sees strings.
  ids: z.string().optional(),
})
export type BadgeFilterQuery = z.infer<typeof badgeFilterQuerySchema>
