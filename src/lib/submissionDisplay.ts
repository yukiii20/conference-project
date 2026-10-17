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

// Colour classes now live in one place: src/lib/status.ts - render a status with
// <StatusChip status={status} labels={SUBMISSION_STATUS_LABELS} /> instead of this map.

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
