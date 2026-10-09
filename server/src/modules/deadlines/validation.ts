import { z } from 'zod'

// Mirrors the fixed reference data in database/02_reference_data.sql — these
// are platform reference rows, not something convenors add to, so a fixed
// enum here (rather than a DB round-trip) is the right amount of validation.
export const DEADLINE_TYPE_CODES = [
  'registration',
  'abstract_submission',
  'review',
  'acceptance_notification',
  'full_paper',
  'final_paper',
  'certificate_release',
] as const

const isoDateTime = z.string().trim().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid date/time.')

export const deadlineRowSchema = z
  .object({
    deadline_type: z.enum(DEADLINE_TYPE_CODES),
    opens_at: isoDateTime,
    closes_at: isoDateTime.nullable(),
    is_public: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.closes_at && new Date(data.closes_at).getTime() < new Date(data.opens_at).getTime()) {
      ctx.addIssue({ code: 'custom', message: 'Closing date must be on or after the opening date.', path: ['closes_at'] })
    }
  })

export const updateDeadlinesSchema = z.object({
  deadlines: z.array(deadlineRowSchema).min(1, 'Set at least one date before saving.'),
})

export type UpdateDeadlinesInput = z.infer<typeof updateDeadlinesSchema>
