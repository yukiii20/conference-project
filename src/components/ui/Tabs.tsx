export interface TabItem {
  id: string
  label: string
  count?: number
}

/** Underlined tab bar — active tab uses the brand colour (burgundy) underline + text. */
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
    <div role="tablist" className={`flex gap-4 overflow-x-auto border-b border-border ${className}`}>
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
              isActive ? 'border-brand text-brand' : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t.label}
            {t.count !== undefined ? <span className="ml-1.5 text-text-muted/70">({t.count})</span> : null}
          </button>
        )
      })}
    </div>
  )
}
