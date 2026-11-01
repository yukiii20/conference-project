import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import type { MeUser, MyRoleRow, SessionConference } from './types'

export type MeResponse = {
  user: MeUser
  roles: MyRoleRow[]
  isAdmin: boolean
  /** May manage other admins and platform settings (older backends omit it: treat as isAdmin). */
  isSuperAdmin?: boolean
  /** The conference this session is bound to; null for a platform-admin session. */
  conference: SessionConference | null
}

type SwitchResponse = {
  user: MeUser
  roles: MyRoleRow[]
  conference: SessionConference
}

type AuthState = {
  user: MeUser | null
  roles: MyRoleRow[]
  isAdmin: boolean
  isSuperAdmin: boolean
  /** The conference the current session is bound to (null when signed out or signed in as platform admin). */
  conference: SessionConference | null
  /** True only while the very first check is in flight. Callers that need a fresh check on their own mount (route guards) should call refresh() themselves and await its result, rather than relying on this. */
  loading: boolean
  /**
   * The single place that calls GET /api/auth/session (/me without the signed-out 401). Updates the shared state
   * for every consumer (header, portal pages, ...) and returns the fetched
   * snapshot directly (or null if there's no valid session) so a caller
   * that needs the answer right away — a route guard deciding whether to
   * render its children — doesn't have to wait for a re-render.
   */
  refresh: () => Promise<MeResponse | null>
  /**
   * Calls POST /api/auth/logout, then clears the shared state. Resolves to the
   * slug of the conference the session was bound to (so the caller can return
   * the person to that conference's page), or null.
   */
  signOut: () => Promise<string | null>
  /**
   * Ends the current session and starts one bound to `conferenceId` (where the
   * person has an active role). No password: they're already signed in.
   */
  switchConference: (conferenceId: string) => Promise<SwitchResponse>
}

const AuthContext = createContext<AuthState | null>(null)

/** Waits before each retry of /auth/me after a non-auth failure (Render waking up or redeploying, a proxy 502/504, a network blip). */
const ME_RETRY_DELAYS_MS = [1_000, 3_000, 6_000]

/** Only these mean "this session is really gone". Anything else is transient and must never sign the person out. */
function isSignedOutError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null)
  const [roles, setRoles] = useState<MyRoleRow[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [conference, setConference] = useState<SessionConference | null>(null)
  const [loading, setLoading] = useState(true)
  const lastGoodRef = useRef<MeResponse | null>(null)

  const clear = useCallback(() => {
    lastGoodRef.current = null
    setUser(null)
    setRoles([])
    setIsAdmin(false)
    setIsSuperAdmin(false)
    setConference(null)
  }, [])

  const refresh = useCallback(async (): Promise<MeResponse | null> => {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          // /auth/session answers 200 { user: null } when signed out (no console 401 on public pages).
          const data = await api.get<MeResponse | (Omit<MeResponse, 'user'> & { user: null })>('/auth/session')
          if (!data.user) {
            clear()
            return null
          }
          lastGoodRef.current = data
          setUser(data.user)
          setRoles(data.roles)
          setIsAdmin(data.isAdmin)
          setIsSuperAdmin(data.isSuperAdmin ?? data.isAdmin)
          setConference(data.conference ?? null)
          return data
        } catch (err) {
          if (isSignedOutError(err)) {
            clear()
            return null
          }
          if (attempt >= ME_RETRY_DELAYS_MS.length) {
            // Server still unreachable: keep the person signed in with what we
            // last knew rather than bouncing them to the login page. The next
            // real request will tell us if the session actually ended.
            return lastGoodRef.current
          }
          await sleep(ME_RETRY_DELAYS_MS[attempt]!)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [clear])

  const signOut = useCallback(async (): Promise<string | null> => {
    const data = await api.post<{ conference_slug?: string | null }>('/auth/logout').catch(() => null)
    clear()
    return data?.conference_slug ?? null
  }, [clear])

  const switchConference = useCallback(async (conferenceId: string): Promise<SwitchResponse> => {
    const data = await api.post<SwitchResponse>('/auth/switch-conference', { conference_id: conferenceId })
    setUser(data.user)
    setRoles(data.roles)
    setIsAdmin(false)
    setIsSuperAdmin(false)
    setConference(data.conference)
    return data
  }, [])

  return (
    <AuthContext.Provider value={{ user, roles, isAdmin, isSuperAdmin, conference, loading, refresh, signOut, switchConference }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>.')
  return ctx
}
