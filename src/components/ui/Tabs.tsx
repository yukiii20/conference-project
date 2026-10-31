export interface TabItem {
  id: string
  label: string
  count?: number
}

/** Underlined tab bar — active tab uses the brand colour (navy) text over an indigo underline. */
export function Tabs({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <div role="tablist" className={`flex gap-6 overflow-x-auto border-b border-border-soft ${className}`}>
      {tabs.map((t) => {
        const isActive = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex-shrink-0 whitespace-nowrap border-b-2 px-0.5 py-3 text-sm font-medium transition-colors ${
              isActive ? 'border-button text-brand' : 'border-transparent text-text-muted hover:border-border hover:text-text'
            }`}
          >
            {t.label}
            {t.count !== undefined ? (
              <span
                className={`ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-px text-xs tabular-nums ${
                  isActive ? 'bg-indigo-soft text-button' : 'bg-surface-muted text-text-muted'
                }`}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
