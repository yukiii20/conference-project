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

export const ROOM_EQUIPMENT = ['projector', 'microphone', 'video_conference', 'whiteboard', 'recording'] as const

export const roomSchema = z.object({
  name: z.string().trim().min(1, 'Room name is required.').max(150),
  room_number: optionalText(40, 'Room number'),
  building: optionalText(150, 'Building'),
  floor: optionalText(40, 'Floor'),
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
  equipment: z.array(z.enum(ROOM_EQUIPMENT)).max(ROOM_EQUIPMENT.length).default([]),
  description: optionalText(500, 'Description'),
})
export type RoomInput = z.infer<typeof roomSchema>

export const setRoomStatusSchema = z.object({ status: z.enum(['active', 'inactive']) })

function dateTimeField(label: string) {
  return z.string().trim().refine((v) => !Number.isNaN(new Date(v).getTime()), `Enter a valid ${label}.`)
}

export const scheduleSlotSchema = z
  .object({
    label: z.string().trim().min(1, 'Label is required.').max(100),
    starts_at: dateTimeField('start time'),
    ends_at: dateTimeField('end time'),
  })
  .superRefine((data, ctx) => {
    if (new Date(data.ends_at).getTime() <= new Date(data.starts_at).getTime()) {
      ctx.addIssue({ code: 'custom', message: 'End time must be after the start time.', path: ['ends_at'] })
    }
  })
export type ScheduleSlotInput = z.infer<typeof scheduleSlotSchema>

export const copyDaySchema = z.object({
  from_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date to copy from.'),
  to_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date to copy to.'),
})
export type CopyDayInput = z.infer<typeof copyDaySchema>

export const SESSION_STATUSES = ['draft', 'published', 'cancelled'] as const
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
    slot_id: z.string().uuid().nullable().optional(),
    description: optionalText(2000, 'Description'),
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

export const sessionChairSchema = z.object({
  user_id: z.string().uuid('Choose a person.'),
  chair_role: z.enum(['chair', 'co_chair']).default('chair'),
})
export type SessionChairInput = z.infer<typeof sessionChairSchema>

const DEFAULT_PRESENTATION_MINUTES = 15

export const addPaperPresentationSchema = z.object({
  submission_id: z.string().uuid('Choose a paper.'),
  duration_minutes: z.coerce.number().int().min(1).max(240).default(DEFAULT_PRESENTATION_MINUTES),
})
export type AddPaperPresentationInput = z.infer<typeof addPaperPresentationSchema>

export const addSpeakerPresentationSchema = z.object({
  speaker_id: z.string().uuid('Choose a speaker.'),
  title: z.string().trim().min(1, 'Title is required.').max(300),
  duration_minutes: z.coerce.number().int().min(1).max(240).default(DEFAULT_PRESENTATION_MINUTES),
})
export type AddSpeakerPresentationInput = z.infer<typeof addSpeakerPresentationSchema>

export const reorderPresentationsSchema = z.object({
  presentation_ids: z.array(z.string().uuid()).min(1),
})
export type ReorderPresentationsInput = z.infer<typeof reorderPresentationsSchema>

export const markPresentationSchema = z.object({
  status: z.enum(['presented', 'absent']),
})
export type MarkPresentationInput = z.infer<typeof markPresentationSchema>
