import type { SupporterTier } from '../../lib/validation'

export type Conference = {
  id: string
  slug: string
  code: string
  name: string
  short_name: string | null
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

export type CommitteeMember = {
  member_name: string
  affiliation: string | null
  country: string | null
  member_role: string
  display_order: number
}

export type Committee = {
  id: string
  name: string
  committee_type: string
  description: string | null
  members: CommitteeMember[]
}

export type Speaker = {
  id: string
  full_name: string
  designation: string | null
  affiliation: string | null
  bio: string | null
  photo_path: string | null
  speaker_type: 'keynote' | 'invited' | 'panelist' | 'guest'
}

export type ConferenceAnnouncement = {
  id: string
  title: string
  body: string
  publish_at: string | null
  created_at: string
}

export type SchedulePresentation = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  presentation_order: number
  submission_code: string | null
  authors: string[] | null
  speaker_name: string | null
}

export type ScheduleRow = {
  id: string
  title: string
  session_type: string
  description: string | null
  starts_at: string
  ends_at: string
  status: string
  room: { id: string; name: string; room_number: string | null; building: string | null } | null
  track: { id: string; name: string } | null
  chairs: Array<{ user_id: string; full_name: string; chair_role: 'chair' | 'co_chair' }>
  presentations: SchedulePresentation[]
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
