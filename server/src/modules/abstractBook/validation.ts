import { z } from 'zod'

export const BOOK_ORDERS = ['track', 'session', 'title'] as const

export const generateBookSchema = z.object({
  only_accepted: z.boolean().default(true),
  order: z.enum(BOOK_ORDERS).default('track'),
})
export type GenerateBookInput = z.infer<typeof generateBookSchema>

export const publishBookSchema = z.object({
  is_published: z.boolean(),
})
