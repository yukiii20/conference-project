import { z } from 'zod'

function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
}

export const roomSchema = z.object({
  name: z.string().trim().min(1, 'Room name is required.').max(150),
  building: optionalText(150, 'Building'),
  capacity: z
    .union([z.number(), z.string()])
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v === '' || v == null) return null
      const n = Number(v)
      if (!Number.isInteger(n) || n <= 0) {
        ctx.addIssue({ code: 'custom', message: 'Capacity must be a positive whole number.' })
        return z.NEVER
      }
      return n
    }),
})
export type RoomInput = z.infer<typeof roomSchema>

export const setRoomStatusSchema = z.object({ status: z.enum(['active', 'inactive']) })

// Matches the frontend's current UI scope, not the full DB enum — 'ongoing' /
// 'completed' / 'cancelled' come with the presentations workflow in a later phase.
export const SESSION_STATUSES = ['draft', 'published'] as const
export const SESSION_TYPES = [
  'paper',
  'keynote',
  'panel',
  'workshop',
  'poster',
  'opening',
  'closing',
  'break',
] as const

export const sessionSchema = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(300),
    session_type: z.enum(SESSION_TYPES),
    track_id: z.string().uuid().nullable(),
    room_id: z.string().uuid('Choose a room.'),
    starts_at: z.string().trim().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid start time.'),
    ends_at: z.string().trim().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid end time.'),
    status: z.enum(SESSION_STATUSES),
  })
  .superRefine((data, ctx) => {
    if (new Date(data.ends_at).getTime() <= new Date(data.starts_at).getTime()) {
      ctx.addIssue({ code: 'custom', message: 'End time must be after the start time.', path: ['ends_at'] })
    }
  })
export type SessionInput = z.infer<typeof sessionSchema>
