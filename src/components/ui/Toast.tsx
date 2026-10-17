import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircleIcon, CheckIcon, InfoIcon, XIcon } from './icons'

type ToastVariant = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'bg-ink text-white [&_svg]:text-green-400',
  error: 'bg-ink text-white [&_svg]:text-red-400',
  info: 'bg-ink text-white [&_svg]:text-blue-300',
}

const VARIANT_ICON: Record<ToastVariant, typeof InfoIcon> = {
  success: CheckIcon,
  error: AlertCircleIcon,
  info: InfoIcon,
}

let toastIdCounter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      toastIdCounter += 1
      const id = toastIdCounter
      setToasts((prev) => [...prev, { id, message, variant }])
      window.setTimeout(() => dismiss(id), 5000)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
          {toasts.map((t) => {
            const Icon = VARIANT_ICON[t.variant]
            return (
              <div
                key={t.id}
                role="status"
                className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md px-4 py-3 text-sm shadow-lg ${VARIANT_CLASSES[t.variant]}`}
              >
                <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{t.message}</span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                  className="flex-shrink-0 opacity-70 hover:opacity-100"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
