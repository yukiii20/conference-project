import { SESSION_STATUSES, SESSION_TYPES } from '../../../lib/validation'

export const TRACK_COLORS = ['#DCEEFB', '#FDE7D8', '#E3F2DF', '#F3E3F5', '#FFF4CC', '#E2E8F0'] as const

export function trackColor(trackId: string | null, tracks: Track[]): string {
  if (!trackId) return '#F3F4F6'
  const index = tracks.findIndex((t) => t.id === trackId)
  return TRACK_COLORS[index % TRACK_COLORS.length] ?? '#F3F4F6'
}

export type Room = {
  id: string
  name: string
  room_number: string | null
  building: string | null
  floor: string | null
  capacity: number | null
  equipment: string[]
  description: string | null
  status: 'active' | 'inactive'
}

export type Track = { id: string; name: string }

export type ScheduleSlot = { id: string; label: string; starts_at: string; ends_at: string }

export type SessionRow = {
  id: string
  title: string
  session_type: (typeof SESSION_TYPES)[number]
  description: string | null
  track_id: string | null
  room_id: string
  slot_id: string | null
  starts_at: string
  ends_at: string
  status: (typeof SESSION_STATUSES)[number]
}

export type ChairInfo = { user_id: string; full_name: string; chair_role: 'chair' | 'co_chair' }
export type PresentationInfo = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  presentation_order: number
  submission_code: string | null
  authors: string[] | null
  speaker_name: string | null
}
export type SessionDetail = {
  id: string
  title: string
  chairs: ChairInfo[]
  presentations: PresentationInfo[]
}

export type SchedulableSubmission = { id: string; submission_code: string | null; title: string; track_id: string }
export type Speaker = { id: string; full_name: string }
export type ChairCandidate = { user_id: string; full_name: string }

export type Warnings = {
  unscheduled_papers: Array<{ id: string; title: string; submission_code: string | null }>
  sessions_without_chair: Array<{ id: string; title: string; starts_at: string }>
}

export const EMPTY_ROOM = { name: '', room_number: '', building: '', floor: '', capacity: '', equipment: [] as string[], description: '' }

export const EMPTY_SESSION_FORM = {
  title: '',
  session_type: 'paper' as (typeof SESSION_TYPES)[number],
  track_id: '',
  room_id: '',
  slot_id: '',
  description: '',
  starts_at: '',
  ends_at: '',
  status: 'draft' as (typeof SESSION_STATUSES)[number],
}

export const EMPTY_SLOT_FORM = { label: '', starts_at: '', ends_at: '' }

/** Left-rail + chip colours per session type, so the grid reads at a glance. */
export const SESSION_TYPE_STYLES: Record<(typeof SESSION_TYPES)[number], { rail: string; chip: string }> = {
  paper: { rail: 'border-l-indigo', chip: 'bg-indigo-soft text-button' },
  keynote: { rail: 'border-l-gold', chip: 'bg-gold-soft text-gold-ink' },
  panel: { rail: 'border-l-emerald-500', chip: 'bg-emerald-50 text-emerald-800' },
  workshop: { rail: 'border-l-sky-500', chip: 'bg-sky-50 text-sky-800' },
  poster: { rail: 'border-l-violet-500', chip: 'bg-violet-50 text-violet-800' },
  opening: { rail: 'border-l-brand', chip: 'bg-brand/10 text-brand' },
  closing: { rail: 'border-l-brand', chip: 'bg-brand/10 text-brand' },
  break: { rail: 'border-l-border-strong', chip: 'bg-surface-muted text-text-muted' },
}

/** Ids of non-cancelled sessions that overlap another session in the same room. */
export function findClashes(sessions: SessionRow[]): Set<string> {
  const clashes = new Set<string>()
  const live = sessions.filter((s) => s.status !== 'cancelled')
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      if (a.room_id === b.room_id && a.starts_at < b.ends_at && b.starts_at < a.ends_at) {
        clashes.add(a.id)
        clashes.add(b.id)
      }
    }
  }
  return clashes
}
