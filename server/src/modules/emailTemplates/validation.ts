import { z } from 'zod'

export const saveEmailTemplateSchema = z.object({
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters.').max(300, 'Subject must be 300 characters or fewer.'),
  body_html: z.string().trim().min(1, 'Write the email body.').max(20_000, 'Body must be 20,000 characters or fewer.'),
})
export type SaveEmailTemplateInput = z.infer<typeof saveEmailTemplateSchema>
