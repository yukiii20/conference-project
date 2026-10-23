import type { LucideIcon } from 'lucide-react'

/**
 * Consistent sizing/stroke for every Lucide icon in the app - default 18px /
 * strokeWidth 2 per the design spec. Decorative by default (aria-hidden);
 * pass `label` when the icon is the only content of its control (e.g. an
 * icon-only button) so it gets an accessible name instead.
 */
export function Icon({
  icon: IconComponent,
  size = 18,
  strokeWidth = 2,
  label,
  className,
}: {
  icon: LucideIcon
  size?: number
  strokeWidth?: number
  label?: string
  className?: string
}) {
  return (
    <IconComponent
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
    />
  )
}
