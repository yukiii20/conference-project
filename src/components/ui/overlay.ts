import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

// Shared behaviour for everything that floats above the page: dialogs,
// drawers, menus and tooltips. Kept in one place so every overlay in the app
// handles focus, Escape and scrolling the same way.

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true' && (el.offsetParent !== null || el === document.activeElement),
  )
}

// Body scroll lock is reference-counted so a confirm dialog opened from a
// drawer doesn't unlock the page when only the inner one closes.
let scrollLocks = 0
let savedOverflow = ''
let savedPaddingRight = ''

function lockScroll() {
  if (scrollLocks === 0) {
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    savedOverflow = document.body.style.overflow
    savedPaddingRight = document.body.style.paddingRight
    document.body.style.overflow = 'hidden'
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
  }
  scrollLocks += 1
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1)
  if (scrollLocks === 0) {
    document.body.style.overflow = savedOverflow
    document.body.style.paddingRight = savedPaddingRight
  }
}

// Stack of open modal layers: only the top one reacts to Escape / Tab, so
// nested dialogs behave.
const layers: symbol[] = []

/**
 * Modal-layer behaviour for a dialog or drawer panel:
 * - moves focus into the panel when it opens (first [data-autofocus], else the panel),
 * - keeps Tab / Shift+Tab inside it,
 * - closes on Escape (top-most layer only),
 * - locks page scroll while open,
 * - returns focus to whatever had it before when it closes.
 */
export function useModalLayer(open: boolean, panelRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const id = Symbol('layer')
    layers.push(id)
    const previouslyFocused = document.activeElement as HTMLElement | null
    lockScroll()

    const panel = panelRef.current
    // React's autoFocus focuses without writing an attribute; respect it.
    if (panel && !panel.contains(document.activeElement)) {
      const preferred = panel.querySelector<HTMLElement>('[data-autofocus], [autofocus]')
      ;(preferred ?? panel).focus({ preventScroll: true })
    }

    function onKeyDown(e: KeyboardEvent) {
      if (layers[layers.length - 1] !== id) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = focusableWithin(panelRef.current)
      if (items.length === 0) {
        e.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = layers.indexOf(id)
      if (index >= 0) layers.splice(index, 1)
      unlockScroll()
      // Restore focus only if it is still inside the closing panel (or lost to <body>).
      if (previouslyFocused && document.contains(previouslyFocused)) {
        const active = document.activeElement
        if (!active || active === document.body || panel?.contains(active)) previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [open, panelRef])
}

export type Placement = 'bottom-start' | 'bottom-end' | 'top' | 'bottom' | 'right' | 'left'

/**
 * Fixed-position coordinates for a floating element next to an anchor,
 * flipped to the other side when it would leave the viewport. Recomputed on
 * scroll/resize while `open`. Rendered through a portal, so it is never
 * clipped by an `overflow: hidden/auto` parent (sidebar, table wrapper).
 */
export function useAnchoredPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  placement: Placement,
  gap = 6,
) {
  const [style, setStyle] = useState<{ top: number; left: number; visibility: 'hidden' | 'visible' }>({
    top: -9999,
    left: -9999,
    visibility: 'hidden',
  })

  const update = useCallback(() => {
    const anchor = anchorRef.current
    const floating = floatingRef.current
    if (!anchor || !floating) return
    const a = anchor.getBoundingClientRect()
    const f = floating.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8
    let top = 0
    let left = 0

    switch (placement) {
      case 'bottom-start':
      case 'bottom-end':
      case 'bottom': {
        top = a.bottom + gap
        if (top + f.height > vh - margin && a.top - gap - f.height > margin) top = a.top - gap - f.height
        left = placement === 'bottom-start' ? a.left : placement === 'bottom-end' ? a.right - f.width : a.left + a.width / 2 - f.width / 2
        break
      }
      case 'top': {
        top = a.top - gap - f.height
        if (top < margin) top = a.bottom + gap
        left = a.left + a.width / 2 - f.width / 2
        break
      }
      case 'right': {
        left = a.right + gap
        if (left + f.width > vw - margin) left = a.left - gap - f.width
        top = a.top + a.height / 2 - f.height / 2
        break
      }
      case 'left': {
        left = a.left - gap - f.width
        if (left < margin) left = a.right + gap
        top = a.top + a.height / 2 - f.height / 2
        break
      }
    }

    left = Math.min(Math.max(margin, left), Math.max(margin, vw - f.width - margin))
    top = Math.min(Math.max(margin, top), Math.max(margin, vh - f.height - margin))
    setStyle({ top: Math.round(top), left: Math.round(left), visibility: 'visible' })
  }, [anchorRef, floatingRef, placement, gap])

  useLayoutEffect(() => {
    if (!open) {
      setStyle((s) => (s.visibility === 'hidden' ? s : { top: -9999, left: -9999, visibility: 'hidden' }))
      return
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, update])

  return { style, update }
}

/** Calls `onOutside` for a pointer-down outside every given element. */
export function useOutsidePointer(active: boolean, refs: Array<RefObject<HTMLElement | null>>, onOutside: () => void) {
  const handler = useRef(onOutside)
  handler.current = onOutside
  useEffect(() => {
    if (!active) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (refs.some((r) => r.current?.contains(target))) return
      handler.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}

let idCounter = 0
/** Stable unique id for aria wiring (React's useId output contains ':' which is awkward in selectors). */
export function useStableId(prefix: string): string {
  const ref = useRef<string | null>(null)
  if (ref.current === null) {
    idCounter += 1
    ref.current = `${prefix}-${idCounter}`
  }
  return ref.current
}
