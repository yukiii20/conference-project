import { useId, useState } from 'react'

type FaqItem = { q: string; a: string }

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const baseId = useId()

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface">
      {items.map((item, i) => {
        const open = openIndex === i
        const buttonId = `${baseId}-button-${i}`
        const panelId = `${baseId}-panel-${i}`
        return (
          <div key={item.q}>
            <h3>
              <button
                type="button"
                id={buttonId}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenIndex(open ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium text-text hover:bg-surface-muted/40 sm:text-base"
              >
                {item.q}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
                >
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!open}
              className="px-5 pb-4 text-sm text-text-muted sm:text-base"
            >
              {item.a}
            </div>
          </div>
        )
      })}
    </div>
  )
}
