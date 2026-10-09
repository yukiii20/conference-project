import { z } from 'zod'

export const SPEAKER_TYPES = ['keynote', 'invited', 'panelist', 'guest'] as const

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? undefined : v))

export const createSpeakerSchema = z.object({
  full_name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(200, 'Name must be 200 characters or fewer.'),
  designation: optionalTrimmed(200),
  affiliation: optionalTrimmed(300),
  bio: optionalTrimmed(5000),
  speaker_type: z.enum(SPEAKER_TYPES).default('invited'),
  is_public: z.boolean().default(true),
})
export type CreateSpeakerInput = z.infer<typeof createSpeakerSchema>

export const updateSpeakerSchema = z.object({
  full_name: z.string().trim().min(2).max(200).optional(),
  designation: optionalTrimmed(200),
  affiliation: optionalTrimmed(300),
  bio: optionalTrimmed(5000),
  speaker_type: z.enum(SPEAKER_TYPES).optional(),
  is_public: z.boolean().optional(),
})
export type UpdateSpeakerInput = z.infer<typeof updateSpeakerSchema>

export const reorderSpeakersSchema = z.object({
  speaker_ids: z.array(z.string().uuid()).min(1),
})
