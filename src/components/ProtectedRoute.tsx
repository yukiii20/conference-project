import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { AppShellSkeleton } from './AppShellSkeleton'

type Props =
  | { kind: 'convenor'; children: React.ReactNode }
  | { kind: 'role'; role: string; children: React.ReactNode }
  /** Any signed-in user, regardless of which roles they hold — used by the shared /portal shell, which shows only the sections each visitor's own roles grant. */
  | { kind: 'authenticated'; children: React.ReactNode }

/**
 * Re-checks access every time this route is mounted (i.e. on every
 * navigation to it), not just once at login — a pending/rejected/removed
 * role never grants access, and an approval takes effect on the next visit.
 * Identity comes only from useAuth()'s refresh(), i.e. GET /api/auth/me —
 * never from a client-side auth SDK session.
 */
export function ProtectedRoute(props: Props) {
  const { refresh } = useAuth()
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking')
  // Where a refused visitor goes: the sign-in page of the conference their
  // session belongs to (a membership only works at its own conference), or the
  // "choose your conference" page when there's no session at all.
  const [deniedTo, setDeniedTo] = useState('/login')
  const roleKey = props.kind === 'role' ? props.role : props.kind === 'convenor' ? 'convenor' : null

  useEffect(() => {
    let cancelled = false

    async function check() {
      setState('checking')
      const data = await refresh()
      if (cancelled) return
      const ok = roleKey === null ? Boolean(data?.user) : (data?.roles.some((r) => r.role_code === roleKey) ?? false)
      if (!ok) setDeniedTo(data?.conference ? `/c/${encodeURIComponent(data.conference.slug)}/login` : '/login')
      setState(ok ? 'ok' : 'denied')
    }

    check()
    return () => {
      cancelled = true
    }
  }, [roleKey, refresh])

  if (state === 'checking') {
    return <AppShellSkeleton />
  }

  if (state === 'denied') {
    return <Navigate to={deniedTo} replace />
  }

  return <>{props.children}</>
}
