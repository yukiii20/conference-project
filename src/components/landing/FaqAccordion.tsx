import { useId, useState } from 'react'
import { Plus } from 'lucide-react'

type FaqItem = { q: string; a: string }

/** One-open-at-a-time accordion. Panels animate their height (grid-rows trick) and are `inert` while closed. */
export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)
  const baseId = useId()

  return (
    <div className="divide-y divide-border border-y border-border">
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
                className="group flex w-full items-center justify-between gap-6 py-5 text-left text-base font-medium text-text transition-colors hover:text-indigo sm:text-lg"
              >
                {item.q}
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
                    open ? 'rotate-45 border-brand bg-brand text-white' : 'border-border text-text-muted group-hover:border-indigo group-hover:text-indigo'
                  }`}
                  aria-hidden="true"
                >
                  <Plus size={16} />
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              inert={!open}
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
              <div className="overflow-hidden">
                <p className="max-w-2xl pb-6 pr-12 leading-relaxed text-text-muted">{item.a}</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
