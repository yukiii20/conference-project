import { z } from 'zod'

export const listRoleRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
})
export type ListRoleRequestsQuery = z.infer<typeof listRoleRequestsQuerySchema>

export const rejectRoleRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Please give a short reason.').max(500, 'Reason must be 500 characters or fewer.'),
})
export type RejectRoleRequestInput = z.infer<typeof rejectRoleRequestSchema>
