import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={`mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border-soft pb-6 ${className}`}>
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-brand sm:text-[1.75rem] sm:leading-tight">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
