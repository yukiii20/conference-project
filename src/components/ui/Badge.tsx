import type { ReactNode } from 'react'
import { statusBadgeClasses, statusLabel, toneBadgeClasses, type StatusTone } from '../../lib/status'

/** Generic pill badge for a fixed tone (not tied to a status string). */
export function Badge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneBadgeClasses(tone)}`}>
      {children}
    </span>
  )
}

/** Status chip driven by the shared status->colour map, e.g. draft/submitted/accepted/revoked. */
export function StatusChip({ status, labels }: { status: string; labels?: Record<string, string> }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClasses(status)}`}>
      {statusLabel(status, labels)}
    </span>
  )
}
