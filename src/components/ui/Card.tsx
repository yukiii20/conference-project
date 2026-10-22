import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-lg border border-border bg-surface p-5 shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold text-text">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
