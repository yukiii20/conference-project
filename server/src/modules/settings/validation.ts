import { z } from 'zod'

export const updateSettingsSchema = z.object({
  review_mode: z.enum(['open', 'single_blind', 'double_blind']),
  reviews_required: z.number().int().min(1).max(10),
  max_submissions_per_author: z.number().int().positive().nullable(),
  max_abstract_words: z.number().int().min(50).max(2000),
  max_file_size_mb: z.number().int().min(1).max(100),
  allowed_file_types: z
    .array(z.string().trim().toLowerCase().min(1).max(20))
    .min(1, 'Allow at least one file type.'),
})
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>
