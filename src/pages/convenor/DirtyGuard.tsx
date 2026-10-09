import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react'

type DirtyGuardValue = {
  /** Call when any field inside the current tab changes — generic, works without touching each form. */
  markDirty: () => void
  /** Call on a real `<form>` submit — optimistic "this probably saved" reset. */
  clearDirty: () => void
  /** Checked before leaving the current tab/page: not dirty -> true immediately; dirty -> asks "Discard changes?" and returns the answer (clearing the flag if the user confirms). */
  confirmLeave: () => boolean
}

const DirtyGuardContext = createContext<DirtyGuardValue | null>(null)

/**
 * One dirty flag shared by the whole convenor/manager portal (not per tab),
 * so it catches both switching tabs within a page and jumping to a different
 * sidebar page — whichever the user was mid-edit on.
 */
export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const dirtyRef = useRef(false)

  const markDirty = useCallback(() => {
    dirtyRef.current = true
  }, [])
  const clearDirty = useCallback(() => {
    dirtyRef.current = false
  }, [])
  const confirmLeave = useCallback(() => {
    if (!dirtyRef.current) return true
    const ok = window.confirm('Discard changes?')
    if (ok) dirtyRef.current = false
    return ok
  }, [])

  return <DirtyGuardContext.Provider value={{ markDirty, clearDirty, confirmLeave }}>{children}</DirtyGuardContext.Provider>
}

export function useDirtyGuard(): DirtyGuardValue {
  const ctx = useContext(DirtyGuardContext)
  if (!ctx) throw new Error('useDirtyGuard() must be used inside <DirtyGuardProvider>.')
  return ctx
}
