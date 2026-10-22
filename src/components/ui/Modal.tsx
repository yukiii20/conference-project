import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import type { ButtonVariant } from './Button'

const SIZE_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
} as const

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  size?: keyof typeof SIZE_CLASSES
  labelledBy?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelledBy ?? 'modal-title' : undefined}
        tabIndex={-1}
        className={`max-h-full w-full overflow-y-auto rounded-lg bg-surface p-5 shadow-lg focus:outline-none ${SIZE_CLASSES[size]}`}
      >
        {title ? (
          <h2 id={labelledBy ?? 'modal-title'} className="text-lg font-semibold text-text">
            {title}
          </h2>
        ) : null}
        {children}
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
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div className="mt-2 text-sm text-text-muted">{message}</div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={confirmVariant} onClick={onConfirm} loading={busy} autoFocus>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
