import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useOutsidePointer, useStableId, type Placement } from './overlay'

export type PopoverTriggerProps = {
  ref: Ref<HTMLButtonElement>
  type: 'button'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  'aria-haspopup': 'dialog'
  onClick: () => void
}

/**
 * Non-modal floating panel (filters, column chooser, date pickers): the page
 * stays usable behind it. Escape closes it and returns focus to the trigger;
 * a click outside closes it.
 */
export function Popover({
  trigger,
  children,
  label,
  placement = 'bottom-end',
  width = 'w-72',
}: {
  trigger: (props: PopoverTriggerProps & { open: boolean }) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  label: string
  placement?: Placement
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useStableId('popover')
  const { style } = useAnchoredPosition(open, triggerRef, panelRef, placement)

  useOutsidePointer(open, [triggerRef, panelRef], () => setOpen(false))

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open && style.visibility === 'visible') {
      panelRef.current?.querySelector<HTMLElement>('input, select, button, [tabindex="0"]')?.focus({ preventScroll: true })
    }
  }, [open, style.visibility])

  const close = () => setOpen(false)

  return (
    <>
      {trigger({
        ref: triggerRef,
        type: 'button',
        open,
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
        'aria-haspopup': 'dialog',
        onClick: () => setOpen((v) => !v),
      })}
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role="dialog"
              aria-label={label}
              style={{ position: 'fixed', top: style.top, left: style.left, visibility: style.visibility }}
              className={`z-[70] ${width} max-w-[calc(100vw-16px)] animate-pop-in rounded-lg border border-border-soft bg-surface text-text shadow-pop`}
            >
              {typeof children === 'function' ? children(close) : children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/** Live media-query match (e.g. '(min-width: 768px)' = Tailwind md and up). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => true,
  )
}
