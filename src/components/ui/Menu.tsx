import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { useAnchoredPosition, useOutsidePointer, useStableId, type Placement } from './overlay'

export type MenuItem =
  | {
      type?: 'item'
      label: string
      icon?: ReactNode
      /** Secondary text on the right, e.g. a keyboard shortcut or count. */
      hint?: ReactNode
      onSelect?: () => void
      /** In-app route - rendered as a real link. */
      to?: string
      /** External URL - opens in a new tab. */
      href?: string
      danger?: boolean
      disabled?: boolean
    }
  | { type: 'separator' }
  | { type: 'label'; label: string }

export type MenuTriggerProps = {
  ref: Ref<HTMLButtonElement>
  type: 'button'
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: () => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
}

/**
 * Accessible dropdown menu (WAI-ARIA menu button pattern): Enter/Space/↓
 * open it on the first item, ↑ on the last; ↑/↓/Home/End move; Escape closes
 * and returns focus to the trigger; Tab or a click outside closes it.
 */
export function DropdownMenu({
  items,
  trigger,
  placement = 'bottom-end',
  label,
  width = 'w-56',
}: {
  items: MenuItem[]
  /** Render the trigger button yourself (spread the given props on a <button>). */
  trigger: (props: MenuTriggerProps & { open: boolean }) => ReactNode
  placement?: Placement
  /** Accessible name for the menu itself. */
  label: string
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<'first' | 'last' | null>(null)
  const menuId = useStableId('menu')
  const { style } = useAnchoredPosition(open, triggerRef, menuRef, placement)

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  useOutsidePointer(open, [triggerRef, menuRef], () => close(false))

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])

  useEffect(() => {
    // Wait until positioned: a visibility:hidden element can't take focus.
    if (!open || !pendingFocus.current || style.visibility !== 'visible') return
    const list = menuItems()
    const target = pendingFocus.current === 'last' ? list[list.length - 1] : list[0]
    pendingFocus.current = null
    target?.focus({ preventScroll: true })
  }, [open, style.visibility])

  function openWith(focus: 'first' | 'last') {
    pendingFocus.current = focus
    setOpen(true)
  }

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const list = menuItems()
    const index = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      list[(index + 1) % list.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      list[(index - 1 + list.length) % list.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      list[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      list[list.length - 1]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  const itemClass = (danger?: boolean, disabled?: boolean) =>
    `flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors ${
      disabled
        ? 'cursor-not-allowed text-text-muted/60'
        : danger
          ? 'text-danger hover:bg-danger/5 focus-visible:bg-danger/5'
          : 'text-text hover:bg-page-bg focus-visible:bg-page-bg'
    } focus-visible:outline-none`

  return (
    <>
      {trigger({
        ref: triggerRef,
        type: 'button',
        open,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: () => (open ? close(false) : openWith('first')),
        onKeyDown: (e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            openWith('first')
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            openWith('last')
          }
        },
      })}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKeyDown}
              style={{ position: 'fixed', top: style.top, left: style.left, visibility: style.visibility }}
              className={`z-[70] max-h-[min(70vh,28rem)] ${width} animate-pop-in overflow-y-auto rounded-lg border border-border-soft bg-surface p-1 text-text shadow-pop`}
            >
              {items.map((item, i) => {
                if (item.type === 'separator') return <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-border-soft" />
                if (item.type === 'label')
                  return (
                    <p key={`label-${i}`} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {item.label}
                    </p>
                  )
                const content = (
                  <>
                    {item.icon ? <span className="flex w-4 shrink-0 justify-center text-current opacity-75 [&_svg]:h-4 [&_svg]:w-4">{item.icon}</span> : null}
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.hint ? <span className="shrink-0 text-xs text-text-muted">{item.hint}</span> : null}
                  </>
                )
                const select = () => {
                  close(!item.to && !item.href)
                  item.onSelect?.()
                }
                if (item.to && !item.disabled)
                  return (
                    <Link key={item.label} to={item.to} role="menuitem" tabIndex={-1} onClick={select} className={itemClass(item.danger)}>
                      {content}
                    </Link>
                  )
                if (item.href && !item.disabled)
                  return (
                    <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" role="menuitem" tabIndex={-1} onClick={select} className={itemClass(item.danger)}>
                      {content}
                    </a>
                  )
                return (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={item.disabled || undefined}
                    onClick={() => !item.disabled && select()}
                    className={itemClass(item.danger, item.disabled)}
                  >
                    {content}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/** The standard "⋯" row-actions menu used in tables and cards. */
export function RowActionsMenu({ items, label = 'Row actions' }: { items: MenuItem[]; label?: string }) {
  if (items.length === 0) return null
  return (
    <DropdownMenu
      label={label}
      items={items}
      trigger={({ open, ...props }) => (
        <button
          {...props}
          aria-label={label}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text ${
            open ? 'bg-surface-muted text-text' : ''
          }`}
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
      )}
    />
  )
}
