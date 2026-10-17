import { createContext, useContext } from 'react'

/**
 * True while a platform admin is viewing a conference's convenor portal read-only
 * (ConvenorPage's `viewAs` prop). The real enforcement is server-side
 * (`blockWritesInAdminViewAsMode` in server/src/app.ts) - this only lets deep
 * components that aren't plain form controls (e.g. ImageUpload's drag-and-drop
 * zone, which a `<fieldset disabled>` ancestor does not reach) skip the request
 * entirely instead of firing one that the server would reject anyway.
 */
const AdminViewAsContext = createContext(false)

export const AdminViewAsProvider = AdminViewAsContext.Provider

export function useIsAdminViewAsReadOnly(): boolean {
  return useContext(AdminViewAsContext)
}
