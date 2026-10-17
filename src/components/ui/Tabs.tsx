export interface TabItem {
  id: string
  label: string
  count?: number
}

/** Underlined tab bar matching the border-button/text-button convention used across the app. */
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
    <div role="tablist" className={`flex gap-4 overflow-x-auto border-b border-line ${className}`}>
      {tabs.map((t) => {
        const isActive = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={`flex-shrink-0 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
              isActive ? 'border-button text-button' : 'border-transparent text-ink/60 hover:text-ink'
            }`}
          >
            {t.label}
            {t.count !== undefined ? <span className="ml-1.5 text-ink/40">({t.count})</span> : null}
          </button>
        )
      })}
    </div>
  )
}
