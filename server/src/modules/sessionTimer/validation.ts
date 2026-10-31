import { z } from 'zod'

const talkMinutes = z.coerce
  .number()
  .int('Talk time must be a whole number of minutes.')
  .min(1, 'Talk time must be at least 1 minute.')
  .max(240, 'Talk time must be 240 minutes or fewer.')
const qaMinutes = z.coerce
  .number()
  .int('Q&A time must be a whole number of minutes.')
  .min(0, 'Q&A time cannot be negative.')
  .max(120, 'Q&A time must be 120 minutes or fewer.')

export const timerDefaultsSchema = z.object({
  talk_minutes: talkMinutes,
  qa_minutes: qaMinutes,
})
export type TimerDefaultsInput = z.infer<typeof timerDefaultsSchema>

/** null for both = go back to the conference default. */
export const sessionTimingSchema = z.object({
  talk_minutes: talkMinutes.nullable(),
  qa_minutes: qaMinutes.nullable(),
})
export type SessionTimingInput = z.infer<typeof sessionTimingSchema>
