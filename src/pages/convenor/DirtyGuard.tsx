import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../../components/ui/Modal'
import { API_SAVED_EVENT } from '../../lib/api'

type DirtyGuardValue = {
  /** Call when any field inside the current tab changes — generic, works without touching each form. */
  markDirty: () => void
  /** Call on a real `<form>` submit — optimistic "this probably saved" reset. */
  clearDirty: () => void
  /**
   * Checked before leaving the current tab/page. Not dirty: returns true and the caller goes
   * ahead. Dirty: returns false (the caller must cancel its navigation) and asks "Discard
   * changes?" in the app's own dialog; if the person confirms, `proceed` is run to finish the
   * navigation the caller just cancelled.
   */
  confirmLeave: (proceed?: () => void) => boolean
}

const DirtyGuardContext = createContext<DirtyGuardValue | null>(null)

/**
 * One dirty flag shared by the whole convenor/manager portal (not per tab),
 * so it catches both switching tabs within a page and jumping to a different
 * sidebar page — whichever the user was mid-edit on.
 *
 * The flag also clears whenever a save request succeeds (API_SAVED_EVENT), so a page saved with
 * a plain button rather than a <form> submit (e.g. Key dates) doesn't ask to discard changes
 * that were already saved.
 */
export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const dirtyRef = useRef(false)
  const [pending, setPending] = useState<{ proceed?: () => void } | null>(null)

  const markDirty = useCallback(() => {
    dirtyRef.current = true
  }, [])
  const clearDirty = useCallback(() => {
    dirtyRef.current = false
  }, [])

  useEffect(() => {
    window.addEventListener(API_SAVED_EVENT, clearDirty)
    return () => window.removeEventListener(API_SAVED_EVENT, clearDirty)
  }, [clearDirty])

  const confirmLeave = useCallback((proceed?: () => void) => {
    if (!dirtyRef.current) return true
    setPending({ proceed })
    return false
  }, [])

  return (
    <DirtyGuardContext.Provider value={{ markDirty, clearDirty, confirmLeave }}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title="Discard changes?"
        message="You have changes on this page that haven't been saved. Leave and lose them?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          dirtyRef.current = false
          const next = pending?.proceed
          setPending(null)
          next?.()
        }}
        onCancel={() => setPending(null)}
      />
    </DirtyGuardContext.Provider>
  )
}

export function useDirtyGuard(): DirtyGuardValue {
  const ctx = useContext(DirtyGuardContext)
  if (!ctx) throw new Error('useDirtyGuard() must be used inside <DirtyGuardProvider>.')
  return ctx
}
