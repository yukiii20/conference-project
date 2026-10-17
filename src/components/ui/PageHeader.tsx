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
    <div className={`mb-6 flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div>
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink/60">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
