/**
 * Turns internal snake_case/dotted identifiers (email template keys, audit
 * log actions) into plain English for display — these are stored as stable
 * machine keys (template_key, audit_logs.action) and must stay that way in
 * the database/API, but a user should never see `convenor_invitation` or
 * `role_request.approve` on screen. See docs/usability-audit.md.
 */

const TEMPLATE_KEY_LABELS: Record<string, string> = {
  account_created: 'Account created',
  announcement: 'Announcement',
  certificate_available: 'Certificate available',
  convenor_invitation: 'Convenor invitation',
  decision_accepted: 'Submission decision: accepted',
  decision_rejected: 'Submission decision: rejected',
  decision_revision_required: 'Submission decision: revision required',
  invitation: 'Role invitation',
  password_reset: 'Password reset',
  presentation_scheduled: 'Presentation scheduled',
  review_assigned: 'Review assigned',
  role_request_approved: 'Role request approved',
  role_request_rejected: 'Role request rejected',
  schedule_changed: 'Schedule changed',
  submission_received: 'Submission received',
}

/** Falls back to a readable title-cased version for any template key not in the map above, rather than showing the raw key. */
export function humanizeTemplateKey(key: string): string {
  return TEMPLATE_KEY_LABELS[key] ?? titleCaseWords(key)
}

const VERB_LABELS: Record<string, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  confirm: 'confirmed',
  cancel: 'cancelled',
  admin_cancel: 'cancelled (by admin)',
  approve: 'approved',
  reject: 'rejected',
  publish: 'published',
  unpublish: 'unpublished',
  check_in: 'checked in',
  check_out: 'checked out',
  assign: 'assigned',
  withdraw: 'withdrawn',
  record: 'recorded',
  issue: 'issued',
  release: 'released',
  revoke: 'revoked',
  grant: 'granted',
  suspend: 'suspended',
  reactivate: 'reactivated',
  anonymize: 'anonymized',
  lock: 'locked',
  unlock: 'unlocked',
  login: 'signed in',
}

function titleCaseWords(s: string): string {
  const words = s.split('_').filter(Boolean)
  if (words.length === 0) return s
  return words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '')
}

/** Generic snake_case -> "Title case" for any other internal identifier shown to a user (e.g. an audit log's entity_type, which is a raw DB table name). */
export function humanizeIdentifier(s: string): string {
  return titleCaseWords(s)
}

/**
 * Audit log actions are stored as `entity.verb` (e.g. `role_request.approve`,
 * `attendance.check_in`) — renders as "Role request approved" where the verb
 * is known, or a readable fallback otherwise. Never shows the raw dotted key.
 */
export function humanizeAuditAction(action: string): string {
  const [entity, verb] = action.split('.')
  if (!entity) return action
  const entityLabel = titleCaseWords(entity)
  if (!verb) return entityLabel
  const verbLabel = VERB_LABELS[verb] ?? verb.replace(/_/g, ' ')
  return `${entityLabel} ${verbLabel}`
}
