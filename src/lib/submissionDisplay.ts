export const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  revision_required: 'Revision required',
  accepted: 'Accepted',
  rejected: 'Rejected',
  full_paper_pending: 'Full paper pending',
  full_paper_submitted: 'Full paper submitted',
  final_approved: 'Final approved',
  scheduled: 'Scheduled',
  presented: 'Presented',
  completed: 'Completed',
  withdrawn: 'Withdrawn',
}

const BADGE_BASE = 'inline-block rounded-full px-2 py-0.5 text-xs font-medium'

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'draft':
      return `${BADGE_BASE} bg-ink/10 text-ink/70`
    case 'submitted':
    case 'under_review':
    case 'full_paper_submitted':
      return `${BADGE_BASE} bg-blue-100 text-blue-700`
    case 'revision_required':
      return `${BADGE_BASE} bg-accent/20 text-accent`
    case 'accepted':
    case 'final_approved':
    case 'scheduled':
    case 'presented':
    case 'completed':
      return `${BADGE_BASE} bg-green-100 text-green-700`
    case 'rejected':
    case 'withdrawn':
      return `${BADGE_BASE} bg-red-100 text-red-700`
    case 'full_paper_pending':
      return `${BADGE_BASE} bg-amber-100 text-amber-700`
    default:
      return `${BADGE_BASE} bg-ink/10 text-ink/70`
  }
}

export const FILE_KIND_LABELS: Record<string, string> = {
  abstract: 'Abstract file',
  full_paper: 'Full paper',
  camera_ready: 'Camera-ready',
  supplementary: 'Supplementary material',
  slides: 'Presentation slides',
}

export const DECISION_LABELS: Record<string, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  revision_required: 'Revision required',
}

export const RECOMMENDATION_LABELS: Record<string, string> = {
  accept: 'Accept',
  minor_revision: 'Minor revision',
  major_revision: 'Major revision',
  reject: 'Reject',
}

const EDITABLE_STATUSES = new Set(['draft', 'revision_required'])

export function isSubmissionEditable(status: string): boolean {
  return EDITABLE_STATUSES.has(status)
}

/** True for a submission file stored as an image (abstract/supplementary can be a PNG/JPG/WEBP instead of a document). */
export function isImageFile(mimeType: string | null | undefined): boolean {
  return Boolean(mimeType?.startsWith('image/'))
}
