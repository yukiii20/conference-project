/**
 * One status→colour map for the whole app. Every page that shows a status chip
 * (submissions, reviews, registrations, certificates, role requests, accounts,
 * rooms, email log, ...) should look up its tone here instead of hard-coding
 * bg-x-100/text-x-700 classes locally — see docs/ui-audit.md.
 */
export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

// Step 7B+C palette — withdrawn/inactive/draft-style statuses use 'neutral'.
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-[#E7E5E4] text-[#57534E]',
  info: 'bg-[#E0E7FF] text-[#1E3A8A]',
  warning: 'bg-[#FEF3C7] text-[#92400E]',
  success: 'bg-[#DCFCE7] text-[#166534]',
  danger: 'bg-[#FEE2E2] text-[#991B1B]',
}

// Same tones, plus a border — for banners (Alert, Toast) rather than small pill chips.
const TONE_BANNER_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-[#D6D3D1] bg-[#E7E5E4] text-[#57534E]',
  info: 'border-[#C7D2FE] bg-[#E0E7FF] text-[#1E3A8A]',
  warning: 'border-[#FDE68A] bg-[#FEF3C7] text-[#92400E]',
  success: 'border-[#86EFAC] bg-[#DCFCE7] text-[#166534]',
  danger: 'border-[#FCA5A5] bg-[#FEE2E2] text-[#991B1B]',
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
