import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../../components/ui/Modal'
import { API_SAVED_EVENT } from '../../lib/api'
import { DirtyTracker, type TrackableControl } from '../../lib/dirtyTracker'

type DirtyGuardValue = {
  /**
   * onFocusCapture / onPointerDownCapture / onKeyDownCapture on the page: remembers a field's
   * value before the person edits it (generic, works without touching each form).
   */
  beginEdit: (event: { target: EventTarget | null }) => void
  /** onChangeCapture / onInputCapture on the page: re-compares that field with its baseline. */
  markDirty: (event: { target: EventTarget | null }) => void
  /** Everything on the page is the new baseline (after a save, or after discarding). */
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

function asControl(target: EventTarget | null): TrackableControl | null {
  const el = target as Partial<TrackableControl> | null
  return el && typeof el.tagName === 'string' && typeof el.getAttribute === 'function' ? (el as TrackableControl) : null
}

/**
 * One tracker shared by the whole convenor/manager portal (not per tab), so it catches both
 * switching tabs within a page and jumping to a different sidebar page - whichever the user
 * was mid-edit on.
 *
 * "Dirty" means a field still on the page differs from its value before the person touched
 * it (see lib/dirtyTracker.ts) - never "some event fired". Editing a field and changing it
 * back, searching, filtering, or uploading a picture is not an unsaved change.
 *
 * Every baseline resets when a save request succeeds (API_SAVED_EVENT), so a page saved with
 * a plain button rather than a <form> submit (e.g. Key dates) doesn't ask to discard changes
 * that were already saved. A failed save keeps the changes marked.
 */
export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const trackerRef = useRef(new DirtyTracker())
  const [pending, setPending] = useState<{ proceed?: () => void } | null>(null)

  const beginEdit = useCallback((event: { target: EventTarget | null }) => {
    const el = asControl(event.target)
    if (el) trackerRef.current.begin(el)
  }, [])
  const markDirty = useCallback((event: { target: EventTarget | null }) => {
    const el = asControl(event.target)
    if (el) trackerRef.current.update(el)
  }, [])
  const clearDirty = useCallback(() => {
    trackerRef.current.reset()
  }, [])

  useEffect(() => {
    window.addEventListener(API_SAVED_EVENT, clearDirty)
    return () => window.removeEventListener(API_SAVED_EVENT, clearDirty)
  }, [clearDirty])

  const confirmLeave = useCallback((proceed?: () => void) => {
    if (!trackerRef.current.isDirty()) return true
    setPending({ proceed })
    return false
  }, [])

  return (
    <DirtyGuardContext.Provider value={{ beginEdit, markDirty, clearDirty, confirmLeave }}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title="Discard changes?"
        message="You have changes on this page that haven't been saved. Leave and lose them?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          trackerRef.current.reset()
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
