import { z } from 'zod'

const isoDateTime = z.string().trim().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid date/time.')

export const customQuestionSchema = z
  .object({
    kind: z.enum(['rating', 'text', 'choice']),
    prompt: z.string().trim().min(2, 'Each question needs at least 2 characters.').max(300, 'Questions must be 300 characters or fewer.'),
    options: z.array(z.string().trim().min(1, 'Options cannot be empty.').max(200, 'Options must be 200 characters or fewer.')).max(10).default([]),
    is_required: z.boolean().default(false),
  })
  .superRefine((q, ctx) => {
    if (q.kind === 'choice' && q.options.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'A choice question needs at least 2 options.' })
    }
    if (q.kind === 'choice' && new Set(q.options).size !== q.options.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Options must all be different.' })
    }
  })
  .transform((q) => ({ ...q, options: q.kind === 'choice' ? q.options : [] }))

export const saveSurveySchema = z
  .object({
    title: z.string().trim().min(2, 'Title needs at least 2 characters.').max(200, 'Title must be 200 characters or fewer.'),
    intro: z
      .string()
      .trim()
      .max(2000, 'The introduction must be 2000 characters or fewer.')
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    opens_at: isoDateTime.nullable(),
    closes_at: isoDateTime.nullable(),
    allow_anonymous: z.boolean(),
    custom_questions: z.array(customQuestionSchema).max(10, 'At most 10 custom questions.').default([]),
  })
  .refine((v) => !v.opens_at || !v.closes_at || new Date(v.closes_at) > new Date(v.opens_at), {
    path: ['closes_at'],
    message: 'The survey must close after it opens.',
  })
export type SaveSurveyInput = z.infer<typeof saveSurveySchema>

export const setOpenSchema = z.object({ is_open: z.boolean() })

export const submitResponseSchema = z.object({
  is_anonymous: z.boolean().default(false),
  answers: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        rating: z.number().int().min(1).max(5).nullable().optional(),
        text: z.string().trim().max(5000, 'Answers must be 5000 characters or fewer.').nullable().optional(),
        choice: z.string().trim().max(200).nullable().optional(),
        session_id: z.string().uuid().nullable().optional(),
      }),
    )
    .max(50),
})
export type SubmitResponseInput = z.infer<typeof submitResponseSchema>
