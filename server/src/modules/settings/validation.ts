import { z } from 'zod'

export const updateSettingsSchema = z
  .object({
    review_mode: z.enum(['open', 'single_blind', 'double_blind']),
    reviews_required: z.number().int().min(1).max(10),
    max_submissions_per_author: z.number().int().positive().nullable(),
    max_abstract_words: z.number().int().min(50).max(2000),
    max_file_size_mb: z.number().int().min(1).max(100),
    allowed_file_types: z
      .array(z.string().trim().toLowerCase().min(1).max(20))
      .min(1, 'Allow at least one file type.'),
    authors_see_review_comments: z.boolean(),
    bidding_enabled: z.boolean(),
    bidding_start_at: z.string().min(1).nullable(),
    bidding_end_at: z.string().min(1).nullable(),
    registration_requires_payment: z.boolean(),
    session_attendance_enabled: z.boolean(),
    certificate_min_sessions: z.number().int().positive().nullable(),
    default_currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Enter a 3-letter currency code, e.g. NPR.'),
    review_reminders_enabled: z.boolean(),
    review_reminder_days_before: z
      .array(z.number().int().min(1).max(60))
      .max(5, 'Pick at most 5 reminder points.'),
    review_overdue_reminder_enabled: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.bidding_enabled) {
      if (!data.bidding_start_at || !data.bidding_end_at) {
        ctx.addIssue({ code: 'custom', path: ['bidding_start_at'], message: 'Set a start and end date for the bidding period.' })
        return
      }
      if (new Date(data.bidding_end_at).getTime() <= new Date(data.bidding_start_at).getTime()) {
        ctx.addIssue({ code: 'custom', path: ['bidding_end_at'], message: 'The bidding period must end after it starts.' })
      }
    }
  })
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>
