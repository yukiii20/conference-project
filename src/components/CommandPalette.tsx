import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { normaliseText } from '../lib/dataTable'
import { useModalLayer, useStableId } from './ui/overlay'

export type SearchItem = {
  id: string
  label: string
  /** Group heading in the results, e.g. "Papers". */
  group: string
  /** Extra words that should find this item ("qr", "badges" ...). */
  keywords?: string[]
  /** In-app route to open... */
  to?: string
  /** ...or an action to run (e.g. switch an in-page tab). */
  onSelect?: () => void
}

/** True when the key event comes from somewhere the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function rankSearchItems(items: SearchItem[], query: string): SearchItem[] {
  const q = normaliseText(query.trim())
  if (!q) return items
  const terms = q.split(/\s+/)
  const scored: Array<{ item: SearchItem; score: number }> = []
  for (const item of items) {
    const label = normaliseText(item.label)
    const haystack = `${label} ${normaliseText(item.group)} ${(item.keywords ?? []).map(normaliseText).join(' ')}`
    if (!terms.every((t) => haystack.includes(t))) continue
    const score = label.startsWith(q) ? 0 : label.split(/\s+/).some((w) => w.startsWith(terms[0]!)) ? 1 : label.includes(q) ? 2 : 3
    scored.push({ item, score })
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item)
}

/**
 * "Jump to" search over the destinations available in the current workspace
 * (sidebar pages, their tabs, account pages). Opens with Ctrl/⌘ K or "/".
 */
export function CommandPalette({
  items,
  open,
  onOpenChange,
  beforeNavigate,
}: {
  items: SearchItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Return false to cancel (e.g. the unsaved-changes guard). */
  beforeNavigate?: () => boolean
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useStableId('palette-list')
  const close = () => onOpenChange(false)
  useModalLayer(open, panelRef, close)

  const results = useMemo(() => rankSearchItems(items, query).slice(0, 40), [items, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(item: SearchItem | undefined) {
    if (!item) return
    if (beforeNavigate && !beforeNavigate()) return
    close()
    if (item.onSelect) item.onSelect()
    else if (item.to) navigate(item.to)
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Home' && e.ctrlKey) {
      setActive(0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    }
  }

  if (!open) return null

  let lastGroup = ''
  return createPortal(
    <div
      className="fixed inset-0 z-[65] flex animate-fade-in items-start justify-center bg-brand/40 px-3 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        tabIndex={-1}
        className="w-full max-w-xl animate-pop-in overflow-hidden rounded-xl border border-border-soft bg-surface shadow-pop focus:outline-none"
      >
        <div className="flex items-center gap-3 border-b border-border-soft px-4">
          <Search size={18} aria-hidden="true" className="shrink-0 text-text-muted" />
          <input
            data-autofocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search pages and sections"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page or section…"
            className="min-h-14 flex-1 bg-transparent text-base text-text placeholder:text-text-muted/70 focus:outline-none focus-visible:outline-none"
          />
          <kbd className="hidden rounded border border-border bg-page-bg px-1.5 py-0.5 font-sans text-[11px] text-text-muted sm:block">Esc</kbd>
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-text-muted">No pages match “{query}”.</li>
          ) : (
            results.map((item, index) => {
              const showGroup = item.group !== lastGroup
              lastGroup = item.group
              const isActive = index === active
              return (
                <li key={item.id} role="presentation">
                  {showGroup ? (
                    <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted" aria-hidden="true">
                      {item.group}
                    </p>
                  ) : null}
                  <div
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isActive}
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(item)}
                    className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${
                      isActive ? 'bg-indigo-soft text-brand' : 'text-text'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    {isActive ? <CornerDownLeft size={14} aria-hidden="true" className="shrink-0 text-button" /> : null}
                  </div>
                </li>
              )
            })
          )}
        </ul>
        <div className="flex items-center gap-4 border-t border-border-soft bg-page-bg/60 px-4 py-2 text-xs text-text-muted max-sm:hidden">
          <span>
            <kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> to move
          </span>
          <span>
            <kbd className="font-sans">Enter</kbd> to open
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
