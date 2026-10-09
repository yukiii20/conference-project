import { z } from 'zod'

export const activityLogQuerySchema = z.object({
  actor: z.string().trim().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
})
export type ActivityLogQuery = z.infer<typeof activityLogQuerySchema>
