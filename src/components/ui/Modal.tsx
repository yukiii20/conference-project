import { useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from './Button'
import type { ButtonVariant } from './Button'
import { useModalLayer, useStableId } from './overlay'

const SIZE_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const

/**
 * Accessible dialog: focus moves in on open and back on close, Tab stays
 * inside, Escape and a backdrop click close it, page scroll is locked.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  labelledBy,
  showClose = false,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** Short supporting line under the title. */
  description?: ReactNode
  children: ReactNode
  /** Action row, pinned under the content (right-aligned). */
  footer?: ReactNode
  size?: keyof typeof SIZE_CLASSES
  labelledBy?: string
  /** Show an × button in the corner (for long, form-style dialogs). */
  showClose?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const generatedId = useStableId('dialog-title')
  const titleId = labelledBy ?? generatedId
  const descriptionId = `${titleId}-desc`
  useModalLayer(open, panelRef, onClose)

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex animate-fade-in items-end justify-center bg-brand/45 p-0 backdrop-blur-[2px] sm:items-center sm:px-4 sm:py-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full animate-pop-in flex-col overflow-hidden rounded-t-2xl border border-border-soft bg-surface shadow-pop focus:outline-none sm:max-h-full sm:rounded-xl ${SIZE_CLASSES[size]}`}
      >
        <div className="overflow-y-auto p-6">
          {title ? (
            <h2 id={titleId} className={`text-lg font-semibold tracking-tight text-text ${showClose ? 'pr-10' : ''}`}>
              {title}
            </h2>
          ) : null}
          {description ? (
            <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-text-muted">
              {description}
            </p>
          ) : null}
          {children}
        </div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border-soft bg-page-bg/60 px-6 py-4">{footer}</div>
        ) : null}
        {showClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: ButtonVariant
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={confirmVariant} onClick={onConfirm} loading={busy} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="mt-2 text-sm leading-relaxed text-text-muted">{message}</div>
    </Modal>
  )
}

const DRAWER_WIDTHS = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-xl',
  xl: 'sm:max-w-3xl',
} as const

/**
 * Side panel for record details and secondary forms - keeps the list it was
 * opened from in view. Full-width sheet on phones.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'lg',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: keyof typeof DRAWER_WIDTHS
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useStableId('drawer-title')
  useModalLayer(open, panelRef, onClose)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-brand/40 backdrop-blur-[2px]" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex h-full w-full animate-drawer-in flex-col border-l border-border-soft bg-surface shadow-pop focus:outline-none ${DRAWER_WIDTHS[width]}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-soft px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-lg font-semibold tracking-tight text-text">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-sm text-text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border-soft bg-page-bg/60 px-6 py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
