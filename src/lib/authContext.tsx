import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { api } from './api'
import type { MeUser, MyRoleRow } from './types'

export type MeResponse = {
  user: MeUser
  roles: MyRoleRow[]
  isAdmin: boolean
}

type AuthState = {
  user: MeUser | null
  roles: MyRoleRow[]
  isAdmin: boolean
  /** True only while the very first check is in flight. Callers that need a fresh check on their own mount (route guards) should call refresh() themselves and await its result, rather than relying on this. */
  loading: boolean
  /**
   * The single place that calls GET /api/auth/me. Updates the shared state
   * for every consumer (header, portal pages, ...) and returns the fetched
   * snapshot directly (or null if there's no valid session) so a caller
   * that needs the answer right away — a route guard deciding whether to
   * render its children — doesn't have to wait for a re-render.
   */
  refresh: () => Promise<MeResponse | null>
  /** Calls POST /api/auth/logout, then clears the shared state. */
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null)
  const [roles, setRoles] = useState<MyRoleRow[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const data = await api.get<MeResponse>('/auth/me')
      setUser(data.user)
      setRoles(data.roles)
      setIsAdmin(data.isAdmin)
      return data
    } catch {
      setUser(null)
      setRoles([])
      setIsAdmin(false)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    setUser(null)
    setRoles([])
    setIsAdmin(false)
  }, [])

  return (
    <AuthContext.Provider value={{ user, roles, isAdmin, loading, refresh, signOut }}>{children}</AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>.')
  return ctx
}
