import type { ReactNode } from 'react'
import { AlertCircleIcon, AlertTriangleIcon, CheckIcon, InfoIcon } from './icons'
import { toneBannerClasses, type StatusTone } from '../../lib/status'

type AlertVariant = 'info' | 'success' | 'warning' | 'danger'

// Same tones as StatusChip/Toast — a success alert must be the same green as a success toast.
const VARIANT_TONE: Record<AlertVariant, StatusTone> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
}

const VARIANT_ICON: Record<AlertVariant, typeof InfoIcon> = {
  info: InfoIcon,
  success: CheckIcon,
  warning: AlertTriangleIcon,
  danger: AlertCircleIcon,
}

export function Alert({ variant = 'info', children }: { variant?: AlertVariant; children: ReactNode }) {
  const Icon = VARIANT_ICON[variant]
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed ${toneBannerClasses(VARIANT_TONE[variant])}`}
    >
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div>{children}</div>
    </div>
  )
}
