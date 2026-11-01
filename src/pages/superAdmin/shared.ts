

export type AdminTab =
  | 'dashboard'
  | 'conferences'
  | 'create-convenor'
  | 'appoint-convenor'
  | 'users'
  | 'admins'
  | 'suggestions'
  | 'settings'
  | 'email-log'
  | 'analytics'

export type ConferenceRow = {
  id: string
  name: string
  code: string
  slug: string
  short_name: string | null
  start_date: string
  end_date: string
  status: string
  submission_count: number
  registration_count: number
}

export type AdminConferenceRow = ConferenceRow & {
  convenor_id: string | null
  convenor_name: string | null
  convenor_email: string | null
}

export type ConvenorInfo = {
  full_name: string | null
  email: string | null
}

export type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  status?: 'active' | 'suspended' | 'deactivated'
  failed_login_count?: number
  locked_until?: string | null
  created_at: string
}

export type PlatformAdminRow = { id: string; full_name: string; email: string; status: string; granted_at: string; is_super_admin?: boolean }

export type DashboardData = {
  conferences_by_status: Array<{ status: string; count: number }>
  archived_conferences: number
  total_users: number
  suspended_users: number
  pending_role_requests: number
  total_submissions: number
  active_registrations: number
  recent_actions: Array<{
    id: number
    occurred_at: string
    actor_name: string | null
    action: string
    entity_type: string
    entity_id: string | null
  }>
  health: {
    database: { ok: boolean; latency_ms: number | null }
    email_mode: string
    failed_emails_24h: number
    queued_emails: number
    storage_disk: { free_bytes: number | null; total_bytes: number | null }
  }
}

export type FaqItem = { q: string; a: string }

export type PlatformSettings = {
  platform_name: string
  support_email: string | null
  footer_text: string | null
  hero_headline: string | null
  hero_subheadline: string | null
  faq_items: FaqItem[]
  notify_admins_of_suggestions: boolean
}

export function formatDate(dateStr: string) {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return dateStr
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatBytes(bytes: number | null) {
  if (bytes == null) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function formatStatus(status: string) {
  return status
    .split('_')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')
}
