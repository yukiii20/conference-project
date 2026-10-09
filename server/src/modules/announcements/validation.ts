import { z } from 'zod'

export const ANNOUNCEMENT_AUDIENCES = ['all', 'authors', 'reviewers', 'session_chairs', 'staff'] as const

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(2, 'Title must be at least 2 characters.').max(200, 'Title must be 200 characters or fewer.'),
  body: z.string().trim().min(1, 'Write the announcement.').max(10_000, 'Body must be 10,000 characters or fewer.'),
  audience: z.array(z.enum(ANNOUNCEMENT_AUDIENCES)).min(1, 'Choose at least one audience.'),
  status: z.enum(['draft', 'scheduled', 'published']).default('draft'),
  publish_at: z.string().datetime().optional(),
  send_email: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.status === 'scheduled' && !v.publish_at) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['publish_at'], message: 'Set a publish date for a scheduled announcement.' })
  }
})
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>

export const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  body: z.string().trim().min(1).max(10_000).optional(),
  audience: z.array(z.enum(ANNOUNCEMENT_AUDIENCES)).min(1).optional(),
  send_email: z.boolean().optional(),
  status: z.enum(['draft', 'scheduled']).optional(),
  publish_at: z.string().datetime().optional().nullable(),
})
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>
