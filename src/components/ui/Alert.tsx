import type { ReactNode } from 'react'
import { AlertCircleIcon, AlertTriangleIcon, CheckIcon, InfoIcon } from './icons'

type AlertVariant = 'info' | 'success' | 'warning' | 'danger'

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  success: 'border-green-200 bg-green-50 text-green-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-600',
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
    <div role="alert" className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${VARIANT_CLASSES[variant]}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div>{children}</div>
    </div>
  )
}
