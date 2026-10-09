import { z } from 'zod'

export const PRESENTATION_PREFERENCES = ['oral', 'poster', 'either'] as const

export const keywordsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(10, 'Up to 10 keywords.')
  .default([])

export const createSubmissionSchema = z.object({
  track_id: z.string().min(1, 'Choose a track.').uuid('Choose a track.'),
  title: z
    .string()
    .trim()
    .min(5, 'Title must be at least 5 characters.')
    .max(300, 'Title must be 300 characters or fewer.'),
  abstract: z.string().trim().min(1, 'Abstract is required.'),
  keywords: keywordsSchema,
  presentation_preference: z.enum(PRESENTATION_PREFERENCES).default('either'),
})
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>

export const updateSubmissionSchema = z.object({
  track_id: z.string().uuid('Choose a track.').optional(),
  title: z
    .string()
    .trim()
    .min(5, 'Title must be at least 5 characters.')
    .max(300, 'Title must be 300 characters or fewer.')
    .optional(),
  abstract: z.string().trim().min(1, 'Abstract is required.').optional(),
  keywords: keywordsSchema.optional(),
  presentation_preference: z.enum(PRESENTATION_PREFERENCES).optional(),
})
export type UpdateSubmissionInput = z.infer<typeof updateSubmissionSchema>

export const withdrawSubmissionSchema = z.object({
  reason: z.string().trim().max(1000, 'Reason must be 1000 characters or fewer.').optional(),
})
export type WithdrawSubmissionInput = z.infer<typeof withdrawSubmissionSchema>

export const addAuthorSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, 'Full name is required.')
    .max(200, 'Full name must be 200 characters or fewer.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  affiliation: z.string().trim().max(300).optional().nullable(),
  department: z.string().trim().max(300).optional().nullable(),
  country: z.string().trim().length(2).toUpperCase().optional().nullable(),
  orcid: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, 'Use the format 0000-0000-0000-000X.')
    .optional()
    .nullable(),
  is_corresponding: z.boolean().optional().default(false),
})
export type AddAuthorInput = z.infer<typeof addAuthorSchema>

export const updateAuthorSchema = z.object({
  full_name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
  affiliation: z.string().trim().max(300).optional().nullable(),
  department: z.string().trim().max(300).optional().nullable(),
  country: z.string().trim().length(2).toUpperCase().optional().nullable(),
  orcid: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, 'Use the format 0000-0000-0000-000X.')
    .optional()
    .nullable(),
  is_corresponding: z.boolean().optional(),
  author_order: z.coerce.number().int().min(1).max(50).optional(),
})
export type UpdateAuthorInput = z.infer<typeof updateAuthorSchema>

export const FILE_KINDS = ['abstract', 'full_paper', 'camera_ready', 'supplementary', 'slides'] as const
export type FileKind = (typeof FILE_KINDS)[number]

export function isFileKind(value: string): value is FileKind {
  return (FILE_KINDS as readonly string[]).includes(value)
}
