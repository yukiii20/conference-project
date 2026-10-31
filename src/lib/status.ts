/**
 * One status→colour map for the whole app. Every page that shows a status chip
 * (submissions, reviews, registrations, certificates, role requests, accounts,
 * rooms, email log, ...) should look up its tone here instead of hard-coding
 * bg-x-100/text-x-700 classes locally — see docs/ui-audit.md.
 */
export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

// Navy/ivory/indigo palette — withdrawn/inactive/draft-style statuses use 'neutral'.
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-[#EEF0F3] text-[#475063] ring-1 ring-inset ring-[#475063]/10',
  info: 'bg-[#EEF0FB] text-[#3443A0] ring-1 ring-inset ring-[#3443A0]/15',
  warning: 'bg-[#FBF3E2] text-[#8A5A0F] ring-1 ring-inset ring-[#8A5A0F]/15',
  success: 'bg-[#E8F5EC] text-[#166534] ring-1 ring-inset ring-[#166534]/15',
  danger: 'bg-[#FDECEC] text-[#9B1C1C] ring-1 ring-inset ring-[#9B1C1C]/15',
}

// Same tones, plus a border — for banners (Alert, Toast) rather than small pill chips.
const TONE_BANNER_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-[#DADDE3] bg-[#F4F5F7] text-[#3B4456]',
  info: 'border-[#CDD2F3] bg-[#F3F4FC] text-[#2F3C92]',
  warning: 'border-[#EED9AE] bg-[#FDF8EC] text-[#7A4F0C]',
  success: 'border-[#B9DFC4] bg-[#F1F9F3] text-[#14592E]',
  danger: 'border-[#F2C2C2] bg-[#FEF4F4] text-[#8F1A1A]',
}

/**
 * Every status string used anywhere in the app, mapped to its semantic tone.
 * draft/pending = neutral or warning, submitted/under review = info,
 * accepted/approved/checked in/valid = success, rejected/revoked/cancelled =
 * danger, withdrawn = neutral.
 */
const STATUS_TONE: Record<string, StatusTone> = {
  // submissions
  draft: 'neutral',
  submitted: 'info',
  under_review: 'info',
  full_paper_submitted: 'info',
  full_paper_pending: 'warning',
  revision_required: 'warning',
  accepted: 'success',
  final_approved: 'success',
  scheduled: 'success',
  presented: 'success',
  completed: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
  // reviews
  assigned: 'info',
  in_progress: 'info',
  declined: 'danger',
  published: 'success',
  // conferences (the conferences.status column itself, not a submission/review status)
  registration_open: 'info',
  submission_open: 'info',
  scheduling: 'warning',
  ongoing: 'success',
  closed: 'neutral',
  // registrations
  pending: 'warning',
  waitlisted: 'warning',
  confirmed: 'success',
  cancelled: 'danger',
  checked_in: 'success',
  // certificates
  issued: 'success',
  revoked: 'danger',
  valid: 'success',
  invalid: 'danger',
  // role requests
  approved: 'success',
  // rooms / misc active-inactive
  active: 'success',
  inactive: 'neutral',
  removed: 'neutral',
  // accounts
  suspended: 'danger',
  deactivated: 'neutral',
  locked: 'danger',
  // email log
  sent: 'success',
  delivered: 'success',
  failed: 'danger',
  bounced: 'danger',
  queued: 'info',
  sending: 'info',
  // suggestions (home page suggestion box, triaged from /super-admin)
  new: 'warning',
  read: 'neutral',
  resolved: 'success',
  archived: 'neutral',
}

export function statusTone(status: string): StatusTone {
  return STATUS_TONE[status] ?? 'neutral'
}

export function statusBadgeClasses(status: string): string {
  return TONE_CLASSES[statusTone(status)]
}

export function toneBadgeClasses(tone: StatusTone): string {
  return TONE_CLASSES[tone]
}

/** Same tones as a bordered banner (Alert, Toast) instead of a small pill chip. */
export function toneBannerClasses(tone: StatusTone): string {
  return TONE_BANNER_CLASSES[tone]
}

/** Human label for a status key, falling back to a title-cased version of the key itself. */
export function statusLabel(status: string, labels?: Record<string, string>): string {
  if (labels?.[status]) return labels[status]
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
