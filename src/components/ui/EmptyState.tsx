import type { ReactNode } from 'react'
import { AlertTriangleIcon } from './icons'
import { Button } from './Button'

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  icon,
}: {
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {icon}
      <p className="font-medium text-ink">{title}</p>
      {message ? <p className="max-w-sm text-sm text-ink/60">{message}</p> : null}
      {actionLabel && onAction ? (
        <Button variant="primary" size="sm" className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function ErrorState({
  message = 'Something went wrong.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <AlertTriangleIcon className="h-8 w-8 text-red-500" />
      <p className="font-medium text-ink">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}
