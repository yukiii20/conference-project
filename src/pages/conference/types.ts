import type { SupporterTier } from '../../lib/validation'

export type Conference = {
  id: string
  slug: string
  code: string
  name: string
  tagline: string | null
  theme: string | null
  description: string | null
  start_date: string
  end_date: string
  city: string | null
  country: string | null
  logo_path: string | null
  banner_path: string | null
  primary_color: string | null
  venue_name: string | null
  address: string | null
  location_map_url: string | null
  contact_email: string | null
  contact_phone: string | null
  website_url: string | null
}

export type Track = { id: string; name: string; description: string | null }

export type Supporter = {
  id: string
  name: string
  tier: SupporterTier
  logo_path: string | null
  website_url: string | null
}

export type Deadline = {
  deadline_type: string
  opens_at: string
  closes_at: string | null
}

export type ScheduleRow = {
  session_id: string
  session_title: string
  session_type: string
  session_starts_at: string
  session_ends_at: string
  room_name: string | null
  track_name: string | null
}

export const DEADLINE_LABELS: Record<string, string> = {
  registration: 'Registration',
  abstract_submission: 'Abstract submission',
  review: 'Review',
  full_paper: 'Full paper submission',
  final_paper: 'Final paper submission',
  acceptance_notification: 'Acceptance notification',
  certificate_release: 'Certificate release',
}
