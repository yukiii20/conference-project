import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useStableId, type Placement } from './overlay'

/**
 * Small hover/focus label. Supplementary only: the wrapped control must still
 * have its own accessible name (visible text, aria-label or sr-only text).
 * Shows after a short delay on hover, immediately on keyboard focus, hides on
 * Escape. Portalled, so overflow containers never clip it.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  disabled = false,
  className = 'inline-flex',
}: {
  content: ReactNode
  children: ReactNode
  placement?: Placement
  disabled?: boolean
  /** Classes for the wrapper element - use "block" / "flex" when wrapping a full-width row. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const id = useStableId('tooltip')
  const visible = open && !disabled
  const { style } = useAnchoredPosition(visible, anchorRef, tipRef, placement, 8)

  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible])

  const show = (delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }

  return (
    <span
      ref={anchorRef}
      className={className}
      onPointerEnter={(e) => e.pointerType === 'mouse' && show(350)}
      onPointerLeave={hide}
      onFocus={(e) => {
        // Keyboard focus only - a mouse click focusing the control shouldn't pop a tooltip.
        if ((e.target as HTMLElement).matches(':focus-visible')) show(0)
      }}
      onBlur={hide}
      onPointerDown={hide}
    >
      {children}
      {visible
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              style={{ position: 'fixed', top: style.top, left: style.left, visibility: style.visibility }}
              className="pointer-events-none z-[90] max-w-xs animate-fade-in rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-pop"
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}
