import { z } from 'zod'

const pageSchema = z.coerce.number().int().min(1).default(1)

export const EMAIL_LOG_STATUSES = ['queued', 'sending', 'sent', 'delivered', 'bounced', 'failed'] as const

export const listEmailLogQuerySchema = z.object({
  status: z.enum(EMAIL_LOG_STATUSES).optional(),
  page: pageSchema,
})
export type ListEmailLogQuery = z.infer<typeof listEmailLogQuerySchema>
