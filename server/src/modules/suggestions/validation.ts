import { z } from 'zod'

export const SUGGESTION_CATEGORIES = ['feature', 'bug', 'question', 'other'] as const
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number]

export const SUGGESTION_STATUSES = ['new', 'read', 'in_progress', 'resolved', 'archived'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

/** Empty string means "not provided", same convention as the rest of this app's optional text fields. */
function optionalTrimmed(max: number) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  )
}

export const createSuggestionSchema = z.object({
  name: optionalTrimmed(120),
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().toLowerCase().email('Enter a valid email address.').max(254).nullable().optional(),
  ),
  category: z.enum(SUGGESTION_CATEGORIES).default('other'),
  message: z
    .string()
    .trim()
    .min(10, 'Please write at least 10 characters.')
    .max(2000, 'Message must be 2000 characters or fewer.'),
  page_url: optionalTrimmed(500),
  // Honeypot: a hidden form field real visitors never fill in. Any non-empty
  // value here means the submitter is a bot — the route accepts it (200) but
  // never persists it. Deliberately untyped/unvalidated beyond "is a string".
  website: z.string().optional(),
})
export type CreateSuggestionInput = z.infer<typeof createSuggestionSchema>

const pageSchema = z.coerce.number().int().min(1).default(1)

export const listSuggestionsQuerySchema = z.object({
  status: z.enum(SUGGESTION_STATUSES).optional(),
  category: z.enum(SUGGESTION_CATEGORIES).optional(),
  q: z.string().trim().max(200).optional(),
  page: pageSchema,
})
export type ListSuggestionsQuery = z.infer<typeof listSuggestionsQuerySchema>

export const exportSuggestionsQuerySchema = z.object({
  status: z.enum(SUGGESTION_STATUSES).optional(),
  category: z.enum(SUGGESTION_CATEGORIES).optional(),
  q: z.string().trim().max(200).optional(),
})
export type ExportSuggestionsQuery = z.infer<typeof exportSuggestionsQuerySchema>

export const updateSuggestionSchema = z
  .object({
    status: z.enum(SUGGESTION_STATUSES).optional(),
    admin_note: optionalTrimmed(2000),
  })
  .refine((data) => data.status !== undefined || data.admin_note !== undefined, {
    message: 'Nothing to update.',
  })
export type UpdateSuggestionInput = z.infer<typeof updateSuggestionSchema>
