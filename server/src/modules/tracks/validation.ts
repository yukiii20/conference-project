import { z } from 'zod'

function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v))
}

export const createTrackSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(200),
  code: optionalText(20, 'Code'),
  description: optionalText(2000, 'Description'),
})
export type CreateTrackInput = z.infer<typeof createTrackSchema>

export const updateTrackSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(200).optional(),
  code: optionalText(20, 'Code'),
  description: optionalText(2000, 'Description'),
})
export type UpdateTrackInput = z.infer<typeof updateTrackSchema>

export const reorderTracksSchema = z.object({
  track_ids: z.array(z.string().uuid()).min(1),
})
export type ReorderTracksInput = z.infer<typeof reorderTracksSchema>
